// Read from stdin and format the test results as markdown
import fs from 'fs';

let buffer = '';

// Read input
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
});

process.stdin.on('end', () => {
  // Process the test content
  const lines = buffer.split('\n');
  
  // Filter out SQL execution lines
  const filteredLines = lines.filter(line => 
    !line.startsWith('Executing (') && 
    !line.includes('Executing SQL')
  );
  
  // Process lines to add Markdown formatting and test indicators
  let output = '# Mocha Test Results\n\n';
  let inTestSuite = false;
  let suiteLevel = 0;
  let currentSection = '';
  
  for (const line of filteredLines) {
    // Handle test suites - main API sections
    if (line.match(/^\s*Chapters API|Chats API|Messages API|Prisons API|Prisoners API|Rules API|User Authentication API/)) {
      output += `\n## ${line.trim()}\n`;
      inTestSuite = true;
      suiteLevel = 1;
      currentSection = line.trim();
    } 
    // Handle test subsections - HTTP endpoints
    else if (line.match(/^\s+[A-Z]/) && line.includes('/')) {
      output += `\n### ${line.trim()}\n`;
      suiteLevel = 2;
    }
    // Handle passing tests (matching both ✓ and ✔ characters)
    else if (line.match(/^\s+[✓✔]/)) {
      output += `${'  '.repeat(suiteLevel)} ✅ ${line.replace(/^\s+[✓✔]\s*/, '')}\n`;
    } 
    // Handle failing tests with links
    else if (line.match(/^\s+\d+\)/)) {
      const testNumMatch = line.match(/^\s+(\d+)\)/);
      if (testNumMatch) {
        const testNum = testNumMatch[1];
        const testName = line.replace(/^\s+\d+\)\s*/, '');
        output += `${'  '.repeat(suiteLevel)} ❌ [${testName}](#failure-${testNum})\n`;
      }
    }
    // Handle test statistics
    else if (line.match(/^\s+\d+ passing/)) {
      output += `\n**${line.trim()}**\n`;
    }
    else if (line.match(/^\s+\d+ failing/)) {
      output += `**${line.trim()}**\n\n`;
      // Don't break here - we'll handle failures differently
    }
  }
  
  // Find where failure details begin
  let failureStartIndex = -1;
  for (let i = 0; i < filteredLines.length; i++) {
    // Look for the first failure pattern after the line that says "x failing"
    if (filteredLines[i].match(/^\s*\d+\)\s+/) && 
        (i > 0 && filteredLines[i-1].match(/^\s*\d+ failing/))) {
      failureStartIndex = i;
      break;
    }
  }
  
  // If failures found, add them with proper formatting
  if (failureStartIndex !== -1) {
    output += '\n## Failures\n\n';
    let currentFailure = '';
    let inFailureBlock = false;
    let failureNum = 1;
    
    for (let i = failureStartIndex; i < filteredLines.length; i++) {
      const line = filteredLines[i];
      
      // Start of a new failure
      if (line.match(/^\s*\d+\)\s+/)) {
        // Close previous failure if there was one
        if (inFailureBlock) {
          output += '```\n\n';
          output += '[⬆ Back to top](#mocha-test-results)\n\n';
        }
        
        // Extract the failure title
        const failureTitle = line.replace(/^\s*\d+\)\s*/, '');
        
        // Create anchor and header
        output += `<a name="failure-${failureNum}"></a>\n`;
        output += `### ${failureNum}) ${failureTitle}\n\n`;
        output += '```\n';
        
        failureNum++;
        inFailureBlock = true;
      } 
      // Add content within a failure block
      else if (inFailureBlock) {
        if (line.trim() && 
            !line.match(/^Connected to|^Test server|^.*table created|^.*database deleted/)) {
          // Make sure to include all stack trace lines
          output += `${line}\n`;
        }
      }
    }
    
    // Close the last failure block if needed
    if (inFailureBlock) {
      output += '```\n\n';
      output += '[⬆ Back to top](#mocha-test-results)\n';
    }
  }
  
  // Write to a file
  fs.writeFileSync('testresults.md', output);
  console.log('Test results markdown generated successfully: testresults.md');
});
