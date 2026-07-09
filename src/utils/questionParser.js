const mammoth = require('mammoth');
const path = require('path');

/**
 * Parse text content from a string (handles .txt format)
 */
function parseTextContent(text) {
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