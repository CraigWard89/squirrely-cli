/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Identity registry for all core tools.
 * Sits at the bottom of the dependency tree to prevent circular imports.
 */

// ============================================================================
// TOOL NAMES
// ============================================================================

export const GLOB_TOOL_NAME = 'glob';
export const GREP_TOOL_NAME = 'grep_search';
export const LS_TOOL_NAME = 'list_directory';
export const READ_FILES_TOOL_NAME = 'read_files';
export const SHELL_TOOL_NAME = 'run_shell_command';
export const WRITE_FILE_TOOL_NAME = 'write_file';
export const EDIT_TOOL_NAME = 'edit_file';
export const WEB_SEARCH_TOOL_NAME = 'google_web_search';

export const WRITE_TODOS_TOOL_NAME = 'write_todos';
export const WEB_FETCH_TOOL_NAME = 'web_fetch';

export const MEMORY_TOOL_NAME = 'save_memory';
export const GET_INTERNAL_DOCS_TOOL_NAME = 'get_internal_docs';
export const ACTIVATE_SKILL_TOOL_NAME = 'activate_skill';
export const ASK_USER_TOOL_NAME = 'ask_user';
export const EXIT_PLAN_MODE_TOOL_NAME = 'exit_plan_mode';
export const ENTER_PLAN_MODE_TOOL_NAME = 'enter_plan_mode';
