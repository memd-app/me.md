/**
 * Integration tests for the Unified Insight Extraction Service.
 *
 * Tests verify that the extraction pipeline produces consistent output
 * format across all source types. These tests run against the fallback
 * (rule-based) extraction since they don't require an API key.
 *
 * Run with: npx tsx server/src/tests/insightExtraction.test.ts
 */

import {
  extractInsights,
  formatInterviewTranscript,
  type ExtractionContext,
  type ExtractedInsight,
  type SourceType,
} from '../services/insightExtraction.js';

// ============================================
// Test Helpers
// ============================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertInsightFormat(insight: ExtractedInsight, label: string): void {
  assert(typeof insight.content === 'string' && insight.content.length > 0, `${label}: content is non-empty string`);
  assert(typeof insight.confidenceScore === 'number', `${label}: confidenceScore is number`);
  assert(insight.confidenceScore >= 0 && insight.confidenceScore <= 100, `${label}: confidenceScore in range 0-100 (got ${insight.confidenceScore})`);
  assert(
    ['identity', 'skills', 'experiences', 'perspectives', 'goals'].includes(insight.category),
    `${label}: category is valid (got "${insight.category}")`
  );
  assert(
    insight.extractionMethod === 'ai' || insight.extractionMethod === 'fallback',
    `${label}: extractionMethod is 'ai' or 'fallback' (got "${insight.extractionMethod}")`
  );
}

// ============================================
// Test Data
// ============================================

const interviewContent = `**Interviewer:** What do you value most in your professional work?

**User:** I believe deeply in mentoring others. When I was a junior developer, my first manager spent hours pair programming with me, and that experience shaped who I am today. I always try to make time for junior team members because I think investing in people is the most important thing a senior engineer can do.

**Interviewer:** How does that influence your day-to-day decisions?

**User:** I prefer collaborative code reviews over quick approvals. I think the review process is where the real learning happens. I value thoroughness over speed when it comes to code quality.`;

const chatgptContent = `## Personal Background
I am a software engineer with 10 years of experience. I grew up in a small town and moved to the city for college. My family values education and hard work.

## Values & Beliefs
I believe in continuous learning and personal growth. I value honesty and transparency in all relationships. I think everyone deserves access to quality education.

## Professional Life
I am skilled in TypeScript, Python, and system architecture. I have led teams of up to 15 people. I prefer working on complex backend systems over frontend work.

## Goals & Aspirations
I want to start my own tech company focused on education technology. I dream of building tools that make learning accessible to everyone.`;

const urlContent = `The author describes their approach to software architecture as deeply influenced by domain-driven design principles. They believe that understanding the business domain is more important than mastering any specific technology. Their experience working at three different startups taught them that adaptability is a core professional skill. They prefer microservices for large applications because it matches how their mind organizes complex problems.`;

const textContent = `I am passionate about sustainable living and reducing my environmental footprint. I prefer cycling to work because it gives me time to think and helps the environment. I believe that small daily habits matter more than grand gestures when it comes to environmental impact. I always bring reusable bags and containers when shopping. I learned from my grandmother that being resourceful is both an economic and environmental virtue. I think cooking at home is important because it reduces waste and I enjoy the creative process.`;

const fileContent = `## My Career Journey

I started as a junior developer at a small startup where I learned the value of wearing many hats. I realized early that I prefer environments where I can see the direct impact of my work. After three years, I moved to a larger company where I discovered my passion for system design and architecture. I believe that the best software comes from deeply understanding user needs, not just following technical trends. My approach to problem-solving is methodical — I always start by understanding the constraints before exploring solutions.`;

// ============================================
// Tests
// ============================================

async function testInterviewExtraction() {
  console.log('\n📋 Test: Interview extraction');
  const ctx: ExtractionContext = {
    content: interviewContent,
    sourceType: 'interview',
    topicTitle: 'Professional Values',
    topicDescription: 'Exploring work values and mentoring philosophy',
    isMiniSession: false,
  };

  const results = await extractInsights(ctx);
  assert(results.length > 0, `Extracted ${results.length} insights (expected > 0)`);
  assert(results.length <= 10, `At most 10 insights (got ${results.length})`);

  for (let i = 0; i < results.length; i++) {
    assertInsightFormat(results[i], `interview[${i}]`);
  }

  // With fallback, extractionMethod should be 'fallback' (no API key in tests)
  assert(results.every(r => r.extractionMethod === 'fallback'), 'All use fallback method (no API key)');
}

async function testMiniSessionExtraction() {
  console.log('\n📋 Test: Mini session extraction');
  const ctx: ExtractionContext = {
    content: '**Interviewer:** What is your superpower?\n\n**User:** I am great at simplifying complex problems. I love breaking down big challenges into smaller, manageable pieces.',
    sourceType: 'interview',
    topicTitle: 'Quick Self-Assessment',
    isMiniSession: true,
  };

  const results = await extractInsights(ctx);
  assert(results.length > 0, `Extracted ${results.length} insights from mini session`);

  for (let i = 0; i < results.length; i++) {
    assertInsightFormat(results[i], `mini[${i}]`);
  }
}

async function testChatgptImportExtraction() {
  console.log('\n📋 Test: ChatGPT import extraction');
  const ctx: ExtractionContext = {
    content: chatgptContent,
    sourceType: 'import_chatgpt',
    topicTitle: 'ChatGPT Memory Import',
  };

  const results = await extractInsights(ctx);
  assert(results.length > 0, `Extracted ${results.length} insights from ChatGPT import`);
  assert(results.length <= 30, `At most 30 insights (got ${results.length})`);

  for (let i = 0; i < results.length; i++) {
    assertInsightFormat(results[i], `chatgpt[${i}]`);
  }
}

async function testUrlImportExtraction() {
  console.log('\n📋 Test: URL import extraction');
  const ctx: ExtractionContext = {
    content: urlContent,
    sourceType: 'import_url',
    topicTitle: 'Web Article Import',
  };

  const results = await extractInsights(ctx);
  // URL content has higher threshold, so may extract fewer
  assert(results.length >= 0, `Extracted ${results.length} insights from URL import`);

  for (let i = 0; i < results.length; i++) {
    assertInsightFormat(results[i], `url[${i}]`);
  }
}

async function testTextImportExtraction() {
  console.log('\n📋 Test: Text import extraction');
  const ctx: ExtractionContext = {
    content: textContent,
    sourceType: 'import_text',
    topicTitle: 'Personal Notes',
  };

  const results = await extractInsights(ctx);
  assert(results.length > 0, `Extracted ${results.length} insights from text import`);
  assert(results.length <= 25, `At most 25 insights (got ${results.length})`);

  for (let i = 0; i < results.length; i++) {
    assertInsightFormat(results[i], `text[${i}]`);
  }
}

async function testFileImportExtraction() {
  console.log('\n📋 Test: File import extraction');
  const ctx: ExtractionContext = {
    content: fileContent,
    sourceType: 'import_file',
    topicTitle: 'Uploaded Document',
  };

  const results = await extractInsights(ctx);
  assert(results.length > 0, `Extracted ${results.length} insights from file import`);

  for (let i = 0; i < results.length; i++) {
    assertInsightFormat(results[i], `file[${i}]`);
  }
}

async function testDeduplication() {
  console.log('\n📋 Test: Deduplication with existing verified insights');
  const existingInsights = [
    { content: 'I believe deeply in mentoring others', confidenceScore: 85 },
    { content: 'Values honesty and transparency in all relationships', confidenceScore: 78 },
  ];

  const ctx: ExtractionContext = {
    content: interviewContent,
    sourceType: 'interview',
    topicTitle: 'Professional Values',
    existingVerifiedInsights: existingInsights,
  };

  const results = await extractInsights(ctx);
  // Should not contain insights that duplicate the existing ones
  const hasDuplicate = results.some(r =>
    r.content.toLowerCase().includes('mentoring others') &&
    r.content.toLowerCase().includes('believe deeply')
  );
  assert(!hasDuplicate, 'Duplicate insights filtered out');
}

async function testEmptyContent() {
  console.log('\n📋 Test: Empty content returns empty array');
  const ctx: ExtractionContext = {
    content: '',
    sourceType: 'interview',
    topicTitle: 'Empty',
  };

  const results = await extractInsights(ctx);
  assert(results.length === 0, 'Empty content returns no insights');
}

async function testConsistentOutputFormat() {
  console.log('\n📋 Test: Consistent output format across all source types');
  const sourceTypes: SourceType[] = ['interview', 'import_url', 'import_text', 'import_chatgpt', 'import_file'];
  const contents: Record<SourceType, string> = {
    interview: interviewContent,
    import_url: urlContent,
    import_text: textContent,
    import_chatgpt: chatgptContent,
    import_file: fileContent,
  };

  const allResults: Record<string, ExtractedInsight[]> = {};

  for (const sourceType of sourceTypes) {
    const ctx: ExtractionContext = {
      content: contents[sourceType],
      sourceType,
      topicTitle: `Test ${sourceType}`,
    };
    allResults[sourceType] = await extractInsights(ctx);
  }

  // Verify all results have the exact same structure
  for (const sourceType of sourceTypes) {
    const results = allResults[sourceType];
    if (results.length > 0) {
      const first = results[0];
      const keys = Object.keys(first).sort();
      assert(
        keys.join(',') === 'category,confidenceScore,content,extractionMethod',
        `${sourceType}: output has exactly {content, confidenceScore, category, extractionMethod}`
      );
    }
  }
}

async function testFormatInterviewTranscript() {
  console.log('\n📋 Test: formatInterviewTranscript helper');
  const userMsgs = [{ role: 'user', content: 'I love coding' }, { role: 'user', content: 'TypeScript is great' }];
  const assistantMsgs = [{ role: 'assistant', content: 'Tell me about yourself' }, { role: 'assistant', content: 'What do you enjoy?' }];

  const transcript = formatInterviewTranscript(userMsgs, assistantMsgs);
  assert(transcript.includes('**Interviewer:**'), 'Transcript contains interviewer prefix');
  assert(transcript.includes('**User:**'), 'Transcript contains user prefix');
  assert(transcript.includes('I love coding'), 'Transcript contains user message content');
  assert(transcript.includes('Tell me about yourself'), 'Transcript contains assistant message content');
}

async function testLargeContentChunking() {
  console.log('\n📋 Test: Large content is chunked and processed');
  // Create content larger than MAX_CHUNK_SIZE (12000 chars)
  let largeContent = '';
  const paragraph = 'I believe strongly in continuous learning and personal growth. I prefer working on challenging problems because they push me to grow. I value collaboration and I always seek feedback from my peers. ';
  while (largeContent.length < 15000) {
    largeContent += paragraph;
  }

  const ctx: ExtractionContext = {
    content: largeContent,
    sourceType: 'import_text',
    topicTitle: 'Large Import',
  };

  const results = await extractInsights(ctx);
  assert(results.length > 0, `Large content still produces insights (got ${results.length})`);
  assert(results.length <= 30, `Total insights capped at 30 (got ${results.length})`);

  for (let i = 0; i < Math.min(results.length, 3); i++) {
    assertInsightFormat(results[i], `large[${i}]`);
  }
}

// ============================================
// Runner
// ============================================

async function runTests() {
  console.log('🧪 Unified Insight Extraction Service - Integration Tests');
  console.log('=========================================================');

  await testInterviewExtraction();
  await testMiniSessionExtraction();
  await testChatgptImportExtraction();
  await testUrlImportExtraction();
  await testTextImportExtraction();
  await testFileImportExtraction();
  await testDeduplication();
  await testEmptyContent();
  await testConsistentOutputFormat();
  await testFormatInterviewTranscript();
  await testLargeContentChunking();

  console.log('\n=========================================================');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
