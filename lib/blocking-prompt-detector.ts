/**
 * BlockingPromptDetector — Detects and auto-responds to blocking prompts.
 *
 * Common blocking prompts detected in agent TUI interactions:
 * - "Continue? [Y/n]" -> responds 'y'
 * - "Proceed? [y/N]" -> responds 'n'
 * - "Do you want to continue?" -> responds 'y'
 * - "Press Enter to continue..." -> responds '\r'
 * - etc.
 */

export interface DetectedPrompt {
  pattern: RegExp
  response: string
  confidence: number
  description: string
}

// Ordered by specificity (most specific first)
const BLOCKING_PROMPTS: DetectedPrompt[] = [
  // Yes/No confirmation patterns
  {
    pattern: /continue\?\s*\[Y\/n\]/i,
    response: 'y',
    confidence: 0.95,
    description: 'Continue? [Y/n] -> y',
  },
  {
    pattern: /proceed\?\s*\[y\/N\]/i,
    response: 'n',
    confidence: 0.9,
    description: 'Proceed? [y/N] -> n',
  },
  {
    pattern: /overwrite\?\s*\[y\/N\]/i,
    response: 'n',
    confidence: 0.9,
    description: 'Overwrite? [y/N] -> n',
  },
  {
    pattern: /skip\?\s*\[y\/N\]/i,
    response: 'n',
    confidence: 0.9,
    description: 'Skip? [y/N] -> n',
  },
  {
    pattern: /cancel\?\s*\[y\/N\]/i,
    response: 'n',
    confidence: 0.9,
    description: 'Cancel? [y/N] -> n',
  },
  {
    pattern: /do you want to continue\?/i,
    response: 'y',
    confidence: 0.85,
    description: 'Do you want to continue? -> y',
  },
  {
    pattern: /are you sure you want to proceed\?/i,
    response: 'y',
    confidence: 0.85,
    description: 'Are you sure you want to proceed? -> y',
  },
  {
    pattern: /confirm\?\s*\[y\/N\]/i,
    response: 'y',
    confidence: 0.85,
    description: 'Confirm? [y/N] -> y',
  },

  // Enter-only patterns
  {
    pattern: /press enter to continue/i,
    response: '\r',
    confidence: 0.9,
    description: 'Press Enter to continue -> Enter',
  },
  {
    pattern: /press enter to proceed/i,
    response: '\r',
    confidence: 0.9,
    description: 'Press Enter to proceed -> Enter',
  },
  {
    pattern: /hit enter to continue/i,
    response: '\r',
    confidence: 0.9,
    description: 'Hit Enter to continue -> Enter',
  },

  // Permission/Danger patterns
  {
    pattern: /permission denied.*\[y\/N\]/i,
    response: 'y',
    confidence: 0.8,
    description: 'Permission denied [y/N] -> y (retry)',
  },
  {
    pattern: /sudo password/i,
    response: '\x03', // Ctrl+C to cancel
    confidence: 0.7,
    description: 'sudo password prompt -> Ctrl+C',
  },

  // Error recovery patterns
  {
    pattern: /error.*retry\?.*\[y\/N\]/i,
    response: 'y',
    confidence: 0.85,
    description: 'Error... retry? [y/N] -> y',
  },
  {
    pattern: /failed.*try again\?.*\[y\/N\]/i,
    response: 'y',
    confidence: 0.85,
    description: 'Failed... try again? [y/N] -> y',
  },

  // Generic yes/no (lower confidence, checked last)
  {
    pattern: /\[y\/N\]\s*$/m,
    response: 'y',
    confidence: 0.6,
    description: 'Generic [y/N] -> y',
  },
  {
    pattern: /\?\[Y\/n\]\s*$/m,
    response: 'y',
    confidence: 0.6,
    description: 'Generic ?[Y/n] -> y',
  },
]

export interface DetectionResult {
  detected: boolean
  prompt?: DetectedPrompt
  matchedText?: string
}

/**
 * Detect if the given tmux pane content contains a blocking prompt.
 * Returns the first matching prompt pattern and its recommended response.
 */
export function detectBlockingPrompt(paneContent: string): DetectionResult {
  for (const prompt of BLOCKING_PROMPTS) {
    const match = paneContent.match(prompt.pattern)
    if (match) {
      return {
        detected: true,
        prompt,
        matchedText: match[0],
      }
    }
  }
  return { detected: false }
}

/**
 * Get the recommended response for a detected prompt.
 * Returns 'y' as default for maximum compatibility with --full-auto modes.
 */
export function getResponseForPrompt(detected: DetectionResult): string {
  if (!detected.detected || !detected.prompt) {
    return 'y' // Safe default for agents in --full-auto / bypassPermissions mode
  }
  return detected.prompt.response
}

/**
 * Get all blocking prompt patterns (for debugging/inspection).
 */
export function getBlockingPromptPatterns(): readonly DetectedPrompt[] {
  return BLOCKING_PROMPTS
}
