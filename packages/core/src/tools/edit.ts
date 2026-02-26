/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as Diff from 'diff';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolConfirmationOutcome,
  type ToolEditConfirmationDetails,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
  type ToolResultDisplay,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../policy/types.js';

import { DEFAULT_DIFF_OPTIONS, getDiffStat } from './diffOptions.js';
import { getDiffContextSnippet } from './diff-utils.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from './modifiable-tool.js';
import { IdeClient } from '../ide/ide-client.js';
import { detectLineEnding } from '../utils/textUtils.js';

import { correctPath } from '../utils/pathCorrector.js';
import {
  EDIT_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  EDIT_DISPLAY_NAME,
} from './tool-names.js';
import { debugLogger } from '../utils/debugLogger.js';
import { EDIT_DEFINITION } from './definitions/coreTools.js';
import { resolveToolDeclaration } from './definitions/resolver.js';

/**
 * Parameters for the Edit tool
 */
export interface EditToolParams {
  /**
   * The path to the file to modify
   */
  file_path: string;

  /**
   * A list of edits to apply.
   */
  edits: Array<{
    /**
     * The 1-based line number to start the replacement at (inclusive).
     */
    start_line: number;

    /**
     * The 1-based line number to end the replacement at (inclusive).
     */
    end_line: number;

    /**
     * The literal text to replace the specified line range with.
     */
    content: string;
  }>;

  /**
   * The instruction for what needs to be done.
   */
  instruction: string;

  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
  originalLineEnding: '\r\n' | '\n';
}

/**
 * Applies a list of line-based edits to the content.
 * Edits are 1-based and inclusive.
 * If start_line > end_line, it's an insertion at start_line.
 */
export function applyLineEdits(
  content: string,
  edits: EditToolParams['edits'],
): string {
  const lines = content.split('\n');
  // Sort edits by start_line descending to apply from bottom up, so line numbers remain valid
  const sortedEdits = [...edits].sort((a, b) => b.start_line - a.start_line);

  let newLines = [...lines];
  for (const edit of sortedEdits) {
    const { start_line, end_line, content: newContent } = edit;

    const startIndex = Math.max(0, start_line - 1);

    // Replacement: lines.splice(startIndex, numLinesToRemove, ...newLinesToAdd)
    const numLinesToRemove = Math.max(0, end_line - start_line + 1);
    const linesToAdd = newContent === '' ? [] : newContent.split('\n');

    newLines.splice(startIndex, numLinesToRemove, ...linesToAdd);
  }

  return newLines.join('\n');
}

class EditToolInvocation
  extends BaseToolInvocation<EditToolParams, ToolResult>
  implements ToolInvocation<EditToolParams, ToolResult>
{
  constructor(
    private readonly config: Config,
    params: EditToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path }];
  }

  /**
   * Calculates the potential outcome of an edit operation.
   * @param params Parameters for the edit operation
   * @returns An object describing the potential edit outcome
   */
  private async calculateEdit(params: EditToolParams): Promise<CalculatedEdit> {
    let currentContent: string | null = null;
    let fileExists = false;
    let originalLineEnding: '\r\n' | '\n' = '\n'; // Default for new files

    try {
      currentContent = await this.config
        .getFileSystemService()
        .readTextFile(params.file_path);
      originalLineEnding = detectLineEnding(currentContent);
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
      fileExists = false;
    }

    if (!fileExists) {
      return {
        currentContent,
        newContent: '',
        isNewFile: false,
        error: {
          display: `File not found. Cannot apply edit.`,
          raw: `File not found: ${params.file_path}. Use ${READ_FILE_TOOL_NAME} to verify the file path.`,
          type: ToolErrorType.FILE_NOT_FOUND,
        },
        originalLineEnding,
      };
    }

    if (currentContent === null) {
      return {
        currentContent,
        newContent: '',
        isNewFile: false,
        error: {
          display: `Failed to read content of file.`,
          raw: `Failed to read content of existing file: ${params.file_path}`,
          type: ToolErrorType.READ_CONTENT_FAILURE,
        },
        originalLineEnding,
      };
    }

    try {
      const newContent = applyLineEdits(currentContent, params.edits);
      return {
        currentContent,
        newContent,
        isNewFile: false,
        error: undefined,
        originalLineEnding,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        currentContent,
        newContent: currentContent,
        isNewFile: false,
        error: {
          display: `Error applying edits: ${errorMsg}`,
          raw: `Error applying edits to ${params.file_path}: ${errorMsg}`,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
        originalLineEnding,
      };
    }
  }

  /**
   * Handles the confirmation prompt for the Edit tool in the CLI.
   * It needs to calculate the diff to show the user.
   */
  protected override async getConfirmationDetails(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(this.params);
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      debugLogger.log(`Error preparing edit: ${errorMsg}`);
      return false;
    }

    if (editData.error) {
      debugLogger.log(`Error: ${editData.error.display}`);
      return false;
    }

    const fileName = path.basename(this.params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      editData.newContent,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS,
    );
    const ideClient = await IdeClient.getInstance();
    const ideConfirmation =
      this.config.getIdeMode() && ideClient.isDiffingEnabled()
        ? ideClient.openDiff(this.params.file_path, editData.newContent)
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `${EDIT_DISPLAY_NAME}: ${shortenPath(makeRelative(this.params.file_path, this.config.getTargetDir()))}`,
      fileName,
      filePath: this.params.file_path,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (_outcome: ToolConfirmationOutcome) => {
        if (ideConfirmation) {
          const result = await ideConfirmation;
          if (result.status === 'accepted' && result.content) {
            // If the user modified the content in the IDE, we should ideally
            // update the params to reflect the final state if we want to
            // support re-applying this edit exactly.
            // For now, we'll just use the IDE content for the write.
            editData.newContent = result.content;
          }
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.config.getTargetDir(),
    );
    return `${EDIT_DISPLAY_NAME}: ${shortenPath(relativePath)} (${this.params.edits.length} edits)`;
  }

  /**
   * Executes the edit operation with the given parameters.
   * @param params Parameters for the edit operation
   * @returns Result of the edit operation
   */
  async execute(signal: AbortSignal): Promise<ToolResult> {
    const resolvedPath = path.resolve(
      this.config.getTargetDir(),
      this.params.file_path,
    );
    const validationError = await this.config.checkWorkspaceExit(
      this.resolvedPath,
      'write',
      signal,
    );
    if (validationError) {
      return {
        llmContent: validationError,
        returnDisplay: 'Workspace access denied.',
        error: {
          message: validationError,
          type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
        },
      };
    }

    try {
      editData = await this.calculateEdit(this.params);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing edit: ${errorMsg}`,
        returnDisplay: `Error preparing edit: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }

    if (editData.error) {
      return {
        llmContent: editData.error.raw,
        returnDisplay: `Error: ${editData.error.display}`,
        error: {
          message: editData.error.raw,
          type: editData.error.type,
        },
      };
    }

    try {
      await this.ensureParentDirectoriesExistAsync(this.params.file_path);
      let finalContent = editData.newContent;

      const useCRLF = editData.originalLineEnding === '\r\n';

      if (useCRLF) {
        finalContent = finalContent.replace(/\r?\n/g, '\r\n');
      }
      await this.config
        .getFileSystemService()
        .writeTextFile(this.params.file_path, finalContent);

      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        editData.currentContent ?? '',
        editData.newContent,
        'Current',
        'Proposed',
        DEFAULT_DIFF_OPTIONS,
      );

      const diffStat = getDiffStat(
        fileName,
        editData.currentContent ?? '',
        editData.newContent,
        '', // newString not used in diffStat for line-based edits
      );

      const displayResult: ToolResultDisplay = {
        fileDiff,
        fileName,
        filePath: this.params.file_path,
        originalContent: editData.currentContent,
        newContent: editData.newContent,
        diffStat,
        isNewFile: editData.isNewFile,
      };

      const llmSuccessMessageParts = [
        `Successfully modified file: ${this.params.file_path} with ${this.params.edits.length} edits.`,
      ];

      const snippet = getDiffContextSnippet(
        editData.currentContent ?? '',
        finalContent,
        5,
      );
      llmSuccessMessageParts.push(`Here is the updated code:
${snippet}`);

      if (this.params.modified_by_user) {
        llmSuccessMessageParts.push(`User modified the edit content manually.`);
      }

      return {
        llmContent: llmSuccessMessageParts.join(' '),
        returnDisplay: displayResult,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing edit: ${errorMsg}`,
        returnDisplay: `Error writing file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }

  /**
   * Creates parent directories if they don't exist
   */
  private async ensureParentDirectoriesExistAsync(
    filePath: string,
  ): Promise<void> {
    const dirName = path.dirname(filePath);
    try {
      await fsPromises.access(dirName);
    } catch {
      await fsPromises.mkdir(dirName, { recursive: true });
    }
  }
}

/**
 * Implementation of the Edit tool logic
 */
export class EditTool
  extends BaseDeclarativeTool<EditToolParams, ToolResult>
  implements ModifiableDeclarativeTool<EditToolParams>
{
  static readonly Name = EDIT_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      EditTool.Name,
      EDIT_DISPLAY_NAME,
      EDIT_DEFINITION.base.description!,
      Kind.Edit,
      EDIT_DEFINITION.base.parametersJsonSchema,
      messageBus,
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  /**
   * Validates the parameters for the Edit tool
   * @param params Parameters to validate
   * @returns Error message string or null if valid
   */
  protected override validateToolParamValues(
    params: EditToolParams,
  ): string | null {
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }

    let filePath = params.file_path;
    if (!path.isAbsolute(filePath)) {
      // Attempt to auto-correct to an absolute path
      const result = correctPath(filePath, this.config);
      if (!result.success) {
        return result.error;
      }
      filePath = result.correctedPath;
    }
    params.file_path = filePath;

    if (params.edits) {
      for (const edit of params.edits) {
        if (edit.start_line < 0) {
          return "Edit 'start_line' must be at least 0.";
        }
        if (edit.end_line < 0) {
          return "Edit 'end_line' must be at least 0.";
        }
      }
    }

    return null;
  }

  protected createInvocation(
    params: EditToolParams,
    messageBus: MessageBus,
  ): ToolInvocation<EditToolParams, ToolResult> {
    return new EditToolInvocation(
      this.config,
      params,
      messageBus,
      this.name,
      this.displayName,
    );
  }

  override getSchema(modelId?: string) {
    return resolveToolDeclaration(EDIT_DEFINITION, modelId);
  }

  getModifyContext(_: AbortSignal): ModifyContext<EditToolParams> {
    return {
      getFilePath: (params: EditToolParams) => params.file_path,
      getCurrentContent: async (params: EditToolParams): Promise<string> => {
        try {
          return await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: EditToolParams): Promise<string> => {
        try {
          const currentContent = await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
          return applyLineEdits(currentContent, params.edits);
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      createUpdatedParams: (
        _oldContent: string,
        modifiedProposedContent: string,
        originalParams: EditToolParams,
      ): EditToolParams => {
        // If the user modified the proposed content, we can't easily map it
        // back to line edits. Instead, we convert it to a single edit that
        // replaces the entire file.
        // TODO(chrstn): Improve this by calculating a diff between oldContent and modifiedProposedContent
        return {
          ...originalParams,
          edits: [
            {
              start_line: 1,
              end_line: _oldContent.split('\n').length,
              content: modifiedProposedContent,
            },
          ],
          modified_by_user: true,
        };
      },
    };
  }
}
