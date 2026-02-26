/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import path from 'node:path';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { READ_MANY_FILES_TOOL_NAME } from './tool-names.js';
import { READ_MANY_FILES_DEFINITION } from './definitions/coreTools.js';
import { resolveToolDeclaration } from './definitions/resolver.js';

/**
 * Parameters for the ReadManyFiles tool
 */
export interface ReadManyFilesToolParams {
  /**
   * List of glob patterns to search for (e.g., ["src/*.ts", "docs/*.md"])
   */
  patterns: string[];

  /**
   * Optional base directory to search from (defaults to project root)
   */
  base_dir?: string;
}

class ReadManyFilesToolInvocation extends BaseToolInvocation<
  ReadManyFilesToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ReadManyFilesToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Searching for patterns: ${this.params.patterns.join(', ')}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { patterns, base_dir } = this.params;
    const targetDir = this.config.getTargetDir();
    const searchBaseDir = base_dir
      ? path.resolve(targetDir, base_dir)
      : targetDir;

    try {
      const fileDiscovery = this.config.getFileService();
      const globExcludes = this.config.getFileExclusions().getReadManyFilesExcludes();

      const allMatches = await fileDiscovery.findFiles(patterns, {
        cwd: searchBaseDir,
        ignore: globExcludes,
        signal,
      });

      if (allMatches.length === 0) {
        return {
          llmContent: 'No files matched the provided patterns.',
          returnDisplay: 'No files found matching the patterns.',
        };
      }

      const relativeMatches = allMatches.map((fullPath) =>
        path.relative(targetDir, fullPath),
      );

      const { filteredPaths, ignoredCount } =
        fileDiscovery.filterFilesWithReport(relativeMatches, {
          respectGitIgnore: true,
          respectGeminiIgnore: true,
        });

      if (filteredPaths.length === 0) {
        return {
          llmContent: `All ${allMatches.length} matching files were ignored by project ignore patterns.`,
          returnDisplay: `All ${allMatches.length} matching files were ignored.`,
        };
      }

      const filesToConsider = new Set<string>();
      for (const relativePath of filteredPaths) {
        const fullPath = path.resolve(targetDir, relativePath);
        const validationError = await this.config.checkWorkspaceExit(
          fullPath,
          'read',
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
        filesToConsider.add(fullPath);
      }

      const results = await Promise.all(
        Array.from(filesToConsider).map(async (fullPath) => {
          try {
            const content = await this.config
              .getFileSystemService()
              .readTextFile(fullPath);
            const relativePath = path.relative(targetDir, fullPath);
            return `--- ${relativePath} ---\n${content}\n`;
          } catch (error) {
            const relativePath = path.relative(targetDir, fullPath);
            return `--- ${relativePath} ---\nError reading file: ${getErrorMessage(error)}\n`;
          }
        }),
      );

      let llmContent = results.join('\n');
      if (ignoredCount > 0) {
        llmContent += `\n\n(${ignoredCount} additional files were ignored by ignore patterns)`;
      }

      return {
        llmContent,
        returnDisplay: `Successfully read ${filesToConsider.size} file(s).`,
      };
    } catch (error) {
      const errorMessage = `Error during file search: ${getErrorMessage(error)}`;
      return {
        llmContent: errorMessage,
        returnDisplay: `## File Search Error\n\nAn error occurred while searching for files:\n\`\`\`\n${getErrorMessage(error)}\n\`\`\``,
        error: {
          message: errorMessage,
          type: ToolErrorType.READ_MANY_FILES_EXECUTION_ERROR,
        },
      };
    }
  }
}

/**
 * Implementation of the ReadManyFiles tool
 */
export class ReadManyFilesTool extends BaseDeclarativeTool<
  ReadManyFilesToolParams,
  ToolResult
> {
  static readonly Name = READ_MANY_FILES_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      ReadManyFilesTool.Name,
      'ReadManyFiles',
      READ_MANY_FILES_DEFINITION.base.description!,
      Kind.Read,
      READ_MANY_FILES_DEFINITION.base.parametersJsonSchema,
      messageBus,
      true,
      false,
    );
  }

  protected override validateToolParamValues(
    params: ReadManyFilesToolParams,
  ): string | null {
    if (!params.patterns || params.patterns.length === 0) {
      return "The 'patterns' parameter must be a non-empty array of glob strings.";
    }
    return null;
  }

  protected createInvocation(
    params: ReadManyFilesToolParams,
    messageBus: MessageBus,
  ): ToolInvocation<ReadManyFilesToolParams, ToolResult> {
    return new ReadManyFilesToolInvocation(
      this.config,
      params,
      messageBus ?? this.messageBus,
      this.name,
      this.displayName,
    );
  }

  override getSchema(modelId?: string) {
    return resolveToolDeclaration(READ_MANY_FILES_DEFINITION, modelId);
  }
}
