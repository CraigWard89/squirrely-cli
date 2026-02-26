/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { glob, escape } from 'glob';
import { makeRelative, shortenPath } from '../utils/paths.js';
import type { ToolInvocation, ToolLocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import type { PartUnion, PartListUnion } from '@google/genai';
import {
  processSingleFileContent,
  getSpecificMimeType,
  detectFileType,
  DEFAULT_ENCODING,
} from '../utils/fileUtils.js';
import type { Config } from '../config/config.js';
import { FileOperation } from '../telemetry/metrics.js';
import { getProgrammingLanguage } from '../telemetry/telemetry-utils.js';
import { logFileOperation } from '../telemetry/loggers.js';
import { FileOperationEvent } from '../telemetry/types.js';
import { READ_FILES_TOOL_NAME, READ_FILES_DISPLAY_NAME } from './tool-names.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { READ_FILES_DEFINITION } from './definitions/coreTools.js';
import { resolveToolDeclaration } from './definitions/resolver.js';
import { REFERENCE_CONTENT_END } from '../utils/constants.js';

const DEFAULT_OUTPUT_SEPARATOR_FORMAT = '--- {filePath} ---';
const DEFAULT_OUTPUT_TERMINATOR = `
${REFERENCE_CONTENT_END}`;

/**
 * Parameters for a single file read within ReadFiles tool
 */
export interface FileReadParams {
  /**
   * The path to the file to read
   */
  file_path: string;

  /**
   * The line number to start reading from (optional, 1-based)
   */
  start_line?: number;

  /**
   * The line number to end reading at (optional, 1-based, inclusive)
   */
  end_line?: number;

  /**
   * If true, includes 1-based line numbers at the start of each line.
   */
  include_line_numbers?: boolean;
}

/**
 * Parameters for the ReadFiles tool
 */
export interface ReadFilesToolParams {
  /**
   * Specific files to read.
   */
  files?: FileReadParams[];

  /**
   * Glob patterns to include.
   */
  include?: string[];

  /**
   * Glob patterns to exclude.
   */
  exclude?: string[];

  /**
   * Whether to respect .gitignore and .geminiignore patterns
   */
  file_filtering_options?: {
    respect_git_ignore?: boolean;
    respect_gemini_ignore?: boolean;
  };
}

class ReadFilesToolInvocation extends BaseToolInvocation<
  ReadFilesToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: ReadFilesToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    const fileCount = (this.params.files?.length ?? 0);
    const includeCount = (this.params.include?.length ?? 0);
    let desc = `Will read `;
    if (fileCount > 0) {
      desc += `${fileCount} specific file(s)`;
    }
    if (includeCount > 0) {
      if (fileCount > 0) desc += ' and ';
      desc += `files matching ${this.params.include!.length} glob patterns`;
    }
    if (fileCount === 0 && includeCount === 0) {
      return 'No files or patterns specified to read.';
    }
    return desc;
  }

  override toolLocations(): ToolLocation[] {
    const locations: ToolLocation[] = [];
    if (this.params.files) {
      for (const file of this.params.files) {
        locations.push({
          path: path.resolve(this.config.getTargetDir(), file.file_path),
          line: file.start_line,
        });
      }
    }
    return locations;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { files = [], include = [], exclude = [] } = this.params;
    const targetDir = this.config.getTargetDir();
    const workspaceDirs = this.config.getWorkspaceContext().getDirectories();
    
    const filesToRead = new Map<string, FileReadParams>();
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const contentParts: PartListUnion = [];
    const processedFilesRelativePaths: string[] = [];

    // 1. Process specific files
    for (const fileParam of files) {
      const resolvedPath = path.resolve(targetDir, fileParam.file_path);
      const validationError = await this.config.checkWorkspaceExit(resolvedPath, 'read', signal);
      if (validationError) {
        return {
          llmContent: validationError,
          returnDisplay: 'Workspace access denied.',
          error: {
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
      filesToRead.set(resolvedPath, fileParam);
    }

        const processedPatterns = [];
        for (const p of include) {
          const normalizedP = p.replace(/\/g, '/');
          const fullPath = path.join(dir, normalizedP);
          let exists = false;
          try {
            await fsPromises.access(fullPath);
            exists = true;
          } catch {
            exists = false;
          }
          processedPatterns.push(exists ? escape(normalizedP) : normalizedP);
        }

        const entriesInDir = await glob(processedPatterns, {
          cwd: dir,
          ignore: effectiveExcludes,
          nodir: true,
          dot: true,
          absolute: true,
          nocase: true,
          signal,
        });
        for (const entry of entriesInDir) allEntries.add(entry);
      }

      const fileDiscovery = this.config.getFileService();
      const relativeEntries = Array.from(allEntries).map(p => path.relative(targetDir, p));
      const { filteredPaths, ignoredCount } = fileDiscovery.filterFilesWithReport(relativeEntries, {
        respectGitIgnore: this.params.file_filtering_options?.respect_git_ignore ?? this.config.getFileFilteringOptions().respectGitIgnore ?? true,
        respectGeminiIgnore: this.params.file_filtering_options?.respect_gemini_ignore ?? this.config.getFileFilteringOptions().respectGeminiIgnore ?? true,
      });

      if (ignoredCount > 0) skippedFiles.push({ path: `${ignoredCount} file(s)`, reason: 'ignored by project ignore files' });

      for (const relPath of filteredPaths) {
        const absPath = path.resolve(targetDir, relPath);
        if (!filesToRead.has(absPath)) {
          const validationError = await this.config.checkWorkspaceExit(absPath, 'read', signal);
          if (validationError) {
            return {
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
          filesToRead.set(absPath, { file_path: relPath });
        }
      }
    }

      return { llmContent: 'No files found to read.', returnDisplay: 'No files read.' };
    }

    const sortedPaths = Array.from(filesToRead.keys()).sort();
    
    const results = await Promise.allSettled(sortedPaths.map(async (filePath) => {
      const params = filesToRead.get(filePath)!;
      const relPath = path.relative(targetDir, filePath).replace(/\/g, '/');
      
      const fileType = await detectFileType(filePath);
      if (['image', 'pdf', 'audio', 'video'].includes(fileType)) {
        // Assets must be explicitly requested or in include
        const fileExtension = path.extname(filePath).toLowerCase();
        const requestedExplicitly = include.some(p => p.toLowerCase().includes(fileExtension) || p.includes(path.basename(filePath, fileExtension)));
        // If it was in 'files' array, it's explicit
        const inFilesArray = files.some(f => path.resolve(targetDir, f.file_path) === filePath);
        
        if (!requestedExplicitly && !inFilesArray) {
          return { success: false, path: relPath, reason: 'asset file not explicitly requested' };
        }
      }

      const result = await processSingleFileContent(
        filePath,
        targetDir,
        this.config.getFileSystemService(),
        params.start_line,
        params.end_line,
        params.include_line_numbers
      );

      if (result.error) return { success: false, path: relPath, reason: result.error };
      return { success: true, path: relPath, filePath, result };
    }));

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const val = res.value;
        if (!val.success) {
          skippedFiles.push({ path: val.path, reason: val.reason });
        } else {
          const { path: relPath, filePath, result } = val;
          if (typeof result.llmContent === 'string') {
            const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace('{filePath}', relPath);
            let content = '';
            if (result.isTruncated) {
               const [start, end] = result.linesShown!;
               const total = result.originalLineCount!;
               content += `[WARNING: This file was truncated. Showing lines ${start}-${end} of ${total}. To read more, use specific start_line/end_line in 'files' parameter.]

`;
            }
            content += result.llmContent;
            contentParts.push(`${separator}

${content}

`);
          } else {
            contentParts.push(result.llmContent);
          }
          processedFilesRelativePaths.push(relPath);
          
          const lines = typeof result.llmContent === 'string' ? result.llmContent.split('
').length : undefined;
          logFileOperation(this.config, new FileOperationEvent(
            READ_FILES_TOOL_NAME,
            FileOperation.READ,
            lines,
            getSpecificMimeType(filePath),
            path.extname(filePath),
            getProgrammingLanguage({ file_path: filePath })
          ));
        }
      } else {
        skippedFiles.push({ path: 'unknown', reason: String(res.reason) });
      }
    }

    if (contentParts.length > 0) contentParts.push(DEFAULT_OUTPUT_TERMINATOR);

    let display = `### ReadFiles Result

`;
    if (processedFilesRelativePaths.length > 0) {
      display += `Read **${processedFilesRelativePaths.length} file(s)**.
`;
      processedFilesRelativePaths.slice(0, 10).forEach(p => display += `- `${p}`
`);
      if (processedFilesRelativePaths.length > 10) display += `- ...and ${processedFilesRelativePaths.length - 10} more.
`;
    }
    if (skippedFiles.length > 0) {
      display += `
**Skipped ${skippedFiles.length} item(s):**
`;
      skippedFiles.slice(0, 5).forEach(s => display += `- `${s.path}` (${s.reason})
`);
      if (skippedFiles.length > 5) display += `- ...and ${skippedFiles.length - 5} more.
`;
    }

    return {
      llmContent: contentParts.length === 0 ? 'No content read.' : contentParts,
      returnDisplay: display.trim()
    };
  }
}

export class ReadFilesTool extends BaseDeclarativeTool<
  ReadFilesToolParams,
  ToolResult
> {
  static readonly Name = READ_FILES_TOOL_NAME;

  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    super(
      ReadFilesTool.Name,
      READ_FILES_DISPLAY_NAME,
      READ_FILES_DEFINITION.base.description!,
      Kind.Read,
      READ_FILES_DEFINITION.base.parametersJsonSchema,
      messageBus,
      true,
      false,
    );
  }

  protected override validateToolParamValues(params: ReadFilesToolParams): string | null {
    if (!params.files && !params.include) {
      return "Either 'files' or 'include' must be provided.";
    }
    if (params.files) {
      for (const f of params.files) {
        if (!f.file_path || f.file_path.trim() === '') return "file_path cannot be empty";
        if (f.start_line !== undefined && f.start_line < 1) return "start_line must be >= 1";
        if (f.end_line !== undefined && f.end_line < 1) return "end_line must be >= 1";
        if (f.start_line && f.end_line && f.start_line > f.end_line) return "start_line cannot be > end_line";
      }
    }
    return null;
  }

  protected createInvocation(
    params: ReadFilesToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<ReadFilesToolParams, ToolResult> {
    return new ReadFilesToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }

  override getSchema(modelId?: string) {
    return resolveToolDeclaration(READ_FILES_DEFINITION, modelId);
  }
}
