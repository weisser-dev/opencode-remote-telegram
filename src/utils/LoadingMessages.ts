/**
 * Witty loading messages shown while the model is working.
 * Rotated every few seconds to give the user feedback that something is happening.
 * Inspired by Qwen Code CLI (Apache-2.0).
 */

const LOADING_MESSAGES = [
  '🤔 Thinking…',
  '🧠 Processing your request…',
  '⚡ Warming up the neurons…',
  '🔍 Reading through the codebase…',
  '🛠 Working on it…',
  '📖 Studying the code…',
  '🧩 Piecing things together…',
  '☕ Converting coffee into code…',
  '💡 Having a lightbulb moment…',
  '🔬 Analyzing the situation…',
  '🎯 Locking on target…',
  '🏗 Building the response…',
  '🧪 Running experiments…',
  '📡 Consulting the cloud…',
  '🤖 Engaging cognitive processors…',
  '🔮 Gazing into the codebase…',
  '🎨 Crafting a response…',
  '🧮 Crunching the numbers…',
  '🌀 Untangling the logic…',
  '🚀 Almost there…',
  '🗺 Navigating the source code…',
  '🔧 Turning the gears…',
  '📝 Drafting the answer…',
  '🎭 Compiling brilliance…',
  '🌊 Going deep…',
];

let lastIndex = -1;

export function getRandomLoadingMessage(): string {
  let idx: number;
  do {
    idx = Math.floor(Math.random() * LOADING_MESSAGES.length);
  } while (idx === lastIndex && LOADING_MESSAGES.length > 1);
  lastIndex = idx;
  return LOADING_MESSAGES[idx];
}
