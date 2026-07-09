const mammoth = require('mammoth');
const path = require('path');

/**
 * Parse simple question format:
 * Q: What is the capital of France?
 * Type: multiple_choice
 * A: London
 * B: Paris
 * C: Berlin
 * D: Madrid
 * Answer: B
 * Points: 2
 */
function parseSimpleQuestions(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const questions = [];
  let current = null;
  let options = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of a new question: "Q:" or "Question:"
    if (/^(Q|Question)\s*[:.]/i.test(line)) {
      // Save previous question if exists
      if (current) {
        if (current.type === 'multiple_choice') current.options = options;
        questions.push(current);
        options = [];
      }
      current = {
        question: line.replace(/^(Q|Question)\s*[:.]\s*/i, '').trim(),
        type: 'multiple_choice',
        points: 1
      };
      continue;
    }

    // Type: descriptive / multiple_choice / etc.
    if (/^Type\s*[:.]/i.test(line)) {
      const type = line.replace(/^Type\s*[:.]\s*/i, '').trim().toLowerCase();
      if (current) current.type = type;
      continue;
    }

    // Option lines: "A: Paris" or "A) Paris"
    if (/^[A-D]\s*[:.)]\s*/.test(line)) {
      const opt = line.replace(/^[A-D]\s*[:.)]\s*/, '').trim();
      options.push(opt);
      continue;
    }

    // Answer: B
    if (/^Answer\s*[:.]/i.test(line)) {
      const ans = line.replace(/^Answer\s*[:.]\s*/i, '').trim();
      if (current && current.type === 'multiple_choice') {
        // Convert letter to index (A->0, B->1, ...)
        const idx = ans.toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < options.length) {
          current.correctAnswer = options[idx];
        } else {
          current.correctAnswer = ans;
        }
      } else {
        current.correctAnswer = ans;
      }
      continue;
    }

    // Points: 5
    if (/^Points\s*[:.]/i.test(line)) {
      const pts = parseInt(line.replace(/^Points\s*[:.]\s*/i, '').trim());
      if (current) current.points = pts || 1;
      continue;
    }

    // If it's a descriptive question with a long text, append to question
    if (current && !/^(Type|Answer|Points)/i.test(line) && !/^[A-D]\s*[:.)]/.test(line)) {
      if (current.question.length < 300) {
        current.question += ' ' + line;
      }
    }
  }

  // Push last question
  if (current) {
    if (current.type === 'multiple_choice') current.options = options;
    questions.push(current);
  }

  return questions;
}

/**
 * Parse text content from a string (handles .txt format)
 * First tries the simple "Q:" format, otherwise falls back to the "Question:" format.
 */
function parseTextContent(text) {
  // If the text contains obvious "Q:" or "Question:" markers, use the simple parser
  if (/^(Q|Question)\s*[:.]/im.test(text)) {
    const result = parseSimpleQuestions(text);
    if (result && result.length > 0) return result;
    // If simple parser returns nothing, fall through to legacy parser
  }

  // Legacy parser (handles "Question:", "Type:", "Options:", etc.)
  const questions = [];
  const blocks = text.split(/\n\s*\n/).filter(block => block.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) continue;

    let question = {};
    let options = [];
    let isOptions = false;

    for (const line of lines) {
      if (line.startsWith('Question:')) {
        question.question = line.replace('Question:', '').trim();
      } else if (line.startsWith('Type:')) {
        question.type = line.replace('Type:', '').trim().toLowerCase();
      } else if (line.startsWith('Options:')) {
        isOptions = true;
        // Options may follow on subsequent lines
      } else if (line.startsWith('Correct:')) {
        question.correctAnswer = line.replace('Correct:', '').trim();
        isOptions = false;
      } else if (line.startsWith('Points:')) {
        question.points = parseInt(line.replace('Points:', '').trim()) || 1;
      } else if (isOptions) {
        // Option line like "A) Paris" or "A. Paris" or just "- Paris"
        const match = line.match(/^([A-Za-z][\)\.]?)\s+(.*)/);
        if (match) {
          options.push({ text: match[2], isCorrect: false });
        } else {
          // If no prefix, just treat as option
          options.push({ text: line });
        }
      } else {
        // If not within options, maybe it's a description or other
        if (!question.description) question.description = '';
        question.description += line + ' ';
      }
    }

    // If we have options and a correct answer, mark the correct one
    if (options.length > 0 && question.correctAnswer) {
      const correctText = question.correctAnswer.trim();
      options = options.map(opt => ({
        ...opt,
        isCorrect: opt.text === correctText || opt.text.includes(correctText)
      }));
    }

    if (question.question) {
      // If no type, default to 'multiple_choice' if options exist, else 'descriptive'
      if (!question.type) {
        question.type = options.length > 0 ? 'multiple_choice' : 'descriptive';
      }
      question.options = options;
      if (!question.points) question.points = 1;
      questions.push(question);
    }
  }

  return questions;
}

/**
 * Parse .docx file buffer using mammoth
 */
async function parseDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value;
    return parseTextContent(text);
  } catch (error) {
    console.error('Docx parsing error:', error);
    // Fallback: try to extract raw text via simple method
    const text = await extractRawTextFromDocx(buffer);
    return parseTextContent(text);
  }
}

/**
 * Fallback: extract raw text from docx using simple XML parsing (if mammoth fails)
 */
async function extractRawTextFromDocx(buffer) {
  // Simple implementation: use mammoth directly, but if not available, return empty
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (e) {
    console.error('extractRawTextFromDocx fallback error:', e);
    return '';
  }
}

module.exports = {
  parseTextContent,
  parseDocx,
  extractRawTextFromDocx
};