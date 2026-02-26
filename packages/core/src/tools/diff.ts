/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import * as path from 'node:path';
import * as Diff from 'diff';
import type { Config } from '../config/config.js';
import { DIFF_TOOL_NAME, DIFF_DISPLAY_NAME } from './tool-names.js';

/**
 * Parameters for the Diff tool
 */
export interface DiffToolParams {
  /**
   * The path to the first file to compare
   */
  file_path_1: string;

  /**
   * The path to the second file to compare
   */
  file_path_2: string;
}

class DiffToolInvocation extends BaseToolInvocation<
  DiffToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: DiffToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Comparing ${this.params.file_path_1} and ${this.params.file_path_2}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const targetDir = this.config.getTargetDir();
    const resolvedPath1 = path.resolve(targetDir, this.params.file_path_1);
    const resolvedPath2 = path.resolve(targetDir, this.params.file_path_2);

    const validationError1 = await this.config.checkWorkspaceExit(
      resolvedPath1,
      'read',
      signal,
    );
    if (validationError1) {
      return {
        llmContent: `Access denied to ${this.params.file_path_1}: ${validationError1}`,
        returnDisplay: 'Workspace access denied.',
        error: {
          message: validationError1,
          type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
        },
      };
    }

    const validationError2 = await this.config.checkWorkspaceExit(
      resolvedPath2,
      'read',
      signal,
    );
    if (validationError2) {
      return {
        llmContent: `Access denied to ${this.params.file_path_2}: ${validationError2}`,
        returnDisplay: 'Workspace access denied.',
        error: {
          message: validationError2,
          type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
        },
      };
    }

    try {
      const fs = this.config.getFileSystemService();
      const content1 = await fs.readTextFile(resolvedPath1);
      const content2 = await fs.readTextFile(resolvedPath2);

      const patch = Diff.createPatch(
        path.basename(resolvedPath1),
        content1,
        content2,
        'file1',
        'file2',
      );

      return {
        llmContent: patch,
        returnDisplay: `Diff between ${this.params.file_path_1} and ${this.params.file_path_2}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error calculating diff: ${errorMessage}`,
        returnDisplay: `Error calculating diff: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.READ_CONTENT_FAILURE,
        },
      };
    }
  }
}

/**
 * Implementation of the Diff tool logic
 */
export class DiffTool extends BaseDeclarativeTool<
  DiffToolParams,
  ToolResult
> {
  static readonly Name = DIFF_TOOL_NAME;

  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    super(
      DiffTool.Name,
      DIFF_DISPLAY_NAME,
      'Shows the differences between two files. Returns a unified diff format.',
      Kind.Read,
      {
        type: 'object',
        properties: {
          file_path_1: {
            description: 'The path to the first file to compare.',
            type: 'string',
          },
          file_path_2: {
            description: 'The path to the second file to compare.',
            type: 'string',
          },
        },
        required: ['file_path_1', 'file_path_2'],
      },
      messageBus,
    );
  }

  protected createInvocation(
    params: DiffToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<DiffToolParams, ToolResult> {
    return new DiffToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
