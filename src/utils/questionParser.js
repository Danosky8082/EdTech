const mammoth = require('mammoth');

async function extractRawTextFromDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function parseTextContent(text) {
  const questions = [];
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) continue;

    let questionLine = lines[0].replace(/^\d+[\.\)]\s*/, '').trim();
    if (!questionLine) continue;

    let type = 'short_answer';
    let points = 2;
    let options = [];

    const optionLines = lines.slice(1).filter(l => /^[A-D][\)\.]\s*/.test(l.trim()));
    if (optionLines.length >= 2) {
      type = 'multiple_choice';
      points = 1;
      let correctIndex = -1;
      for (let i = 0; i < optionLines.length; i++) {
        const line = optionLines[i].trim();
        const match = line.match(/^[A-D][\)\.]\s*(.*?)(\*?)$/);
        if (match) {
          const text = match[1].trim();
          const isCorrect = match[2] === '*';
          options.push({ text, isCorrect });
          if (isCorrect) correctIndex = i;
        }
      }
      if (correctIndex === -1 && options.length > 0) options[0].isCorrect = true;
    }

    if (questionLine.toLowerCase().includes('true') && questionLine.toLowerCase().includes('false')) {
      type = 'true_false';
      points = 1;
      options = [
        { text: 'True', isCorrect: /true/i.test(questionLine) },
        { text: 'False', isCorrect: /false/i.test(questionLine) && !/true/i.test(questionLine) }
      ];
      questionLine = questionLine.replace(/\s*[\(\[]?(true|false)[\)\]]?\s*/gi, '').trim();
    }

    questions.push({ type, question: questionLine, points, options });
  }
  return questions;
}

async function parseDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return parseTextContent(value);
}

module.exports = { parseTextContent, parseDocx, extractRawTextFromDocx };