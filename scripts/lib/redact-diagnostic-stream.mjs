#!/usr/bin/env node
import fs from 'node:fs';

const MAX_INPUT_BYTES = 2097152;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_SUMMARY_LINES = 10;
const MAX_SUMMARY_LINE_CHARS = 1000;
const OUTPUT_NOTICE = '\n[diagnostic output truncated at 1048576 bytes]\n';
const INPUT_NOTICE = `\n[diagnostic input truncated at ${MAX_INPUT_BYTES} bytes]\n`;
const REDACTED = '[REDACTED]';
const options = { summaryMode: false, inputFile: undefined };
let inputBytes = 0;
let outputBytes = 0;
let truncatedInput = false;
let truncatedOutput = false;
let summaryLines = 0;
let lineBuffer = '';

function redact(input) {
  let output = input.replace(/\b(postgres(?:ql)?|redis):\/\/([^\s/@]*@)/gi, (_match, scheme, credentials) => {
    const at = credentials.lastIndexOf('@');
    return `${scheme}://${REDACTED}${credentials.slice(at)}`;
  });
  const labels = /(^|[^\w])(["']?)(password|passwd|pwd|token|secret|api[_-]?key|database[_ -]?url|redis[_ -]?url)(["']?)(\s*[:=]\s*["']?)([^\s,;}"']*)/gi;
  output = output.replace(labels, (_match, prefix, openingQuote, label, closingQuote, separator) => `${prefix}${openingQuote}${label}${closingQuote}${separator}${REDACTED}`);
  return output;
}

function emit(text) {
  if (truncatedOutput || text.length === 0) return;
  const noticeLength = Math.max(Buffer.byteLength(OUTPUT_NOTICE), Buffer.byteLength(INPUT_NOTICE));
  const contentLimit = MAX_OUTPUT_BYTES - noticeLength;
  const available = contentLimit - outputBytes;
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= available) {
    process.stdout.write(bytes);
    outputBytes += bytes.length;
    return;
  }
  const keep = Math.max(0, available);
  let prefix = bytes.subarray(0, keep).toString('utf8');
  while (Buffer.byteLength(prefix, 'utf8') > keep) prefix = prefix.slice(0, -1);
  process.stdout.write(prefix);
  outputBytes += Buffer.byteLength(prefix, 'utf8');
  truncatedOutput = true;
}

function emitLine(line, ending) {
  const safe = redact(line);
  if (options.summaryMode) {
    if (!safe || summaryLines >= MAX_SUMMARY_LINES) return;
    const concise = safe.length > MAX_SUMMARY_LINE_CHARS
      ? `${safe.slice(0, MAX_SUMMARY_LINE_CHARS)} [line truncated]`
      : safe;
    emit(concise + ending);
    summaryLines += 1;
  } else {
    emit(safe + ending);
  }
}

function parseArgs(args) {
  let summarySeen = false;
  let inputFileSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--summary' && !summarySeen) {
      options.summaryMode = true;
      summarySeen = true;
    } else if (args[index] === '--input-file' && !inputFileSeen) {
      const inputFile = args[index + 1];
      if (!inputFile || inputFile.startsWith('--')) throw new Error('invalid arguments');
      options.inputFile = inputFile;
      inputFileSeen = true;
      index += 1;
    } else {
      throw new Error('invalid arguments');
    }
  }
}

async function main() {
  try {
    parseArgs(process.argv.slice(2));
    const input = options.inputFile === undefined ? process.stdin : fs.createReadStream(options.inputFile);
    for await (const chunk of input) {
      if (truncatedInput) continue;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const allowed = Math.min(bytes.length, MAX_INPUT_BYTES - inputBytes);
      inputBytes += allowed;
      if (allowed < bytes.length) truncatedInput = true;
      lineBuffer += bytes.subarray(0, allowed).toString('utf8');
      let newline;
      while ((newline = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newline).replace(/\r$/, '');
        emitLine(line, '\n');
        lineBuffer = lineBuffer.slice(newline + 1);
      }
    }
    if (lineBuffer) emitLine(lineBuffer, '');
    if (!options.summaryMode && (truncatedInput || truncatedOutput)) {
      const notice = truncatedInput ? INPUT_NOTICE : OUTPUT_NOTICE;
      process.stdout.write(notice);
    }
  } catch {
    process.stderr.write(`${new Date().toISOString()} LOG_SANITIZATION_FAILED=YES\n`);
    process.exitCode = 1;
  }
}

await main();
