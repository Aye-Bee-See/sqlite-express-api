// Enhanced Test Results Formatter
// Converts Mocha spec reporter output to nicely formatted markdown

import fs from 'fs';

let buffer = '';

// Read input from stdin
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
});

process.stdin.on('end', () => {
  // Process the test content
  const lines = buffer.split('\n');
  
  // Filter out noisy database/connection lines
  const filteredLines = lines.filter(line => 
    !line.startsWith('Executing (') && 
    !line.includes('Executing SQL') &&
    !line.match(/^Connected to|^Test server|^.*table created|^.*database deleted/)
  );
  
  // Generate Markdown report
  let output = '# Mocha Test Results\n\n';
  let currentSuite = '';
  let currentSubsuite = '';
  let indentLevel = 0;
  let stats = { passing: 0, failing: 0 };
  let failuresList = [];

  // First pass: Extract test results and structure
  for (let i = 0; i < filteredLines.length; i++) {
    const line = filteredLines[i];
    
    // Handle API sections (main test suites)
    if (line.match(/^\s*([A-Za-z]+ API)$/)) {
      currentSuite = line.trim();
      currentSubsuite = '';
      output += `\n## ${currentSuite}\n\n`;
      indentLevel = 1;
    } 
    // Handle HTTP endpoints (test subsections)
    else if (line.match(/^\s+([A-Z]+ \/[a-z\/?=:]+)$/) && currentSuite) {
      currentSubsuite = line.trim();
      output += `### ${currentSubsuite}\n\n`;
      indentLevel = 2;
    }
    // Handle passing tests
    else if (line.match(/^\s+[✓✔]\s+(.+)$/) && currentSuite) {
      const testName = line.replace(/^\s+[✓✔]\s+/, '').trim();
      output += `${'  '.repeat(indentLevel)}✅ ${testName}\n\n`;
      stats.passing++;
    } 
    // Handle failing tests with links
    else if (line.match(/^\s+\d+\)\s+(.+)$/) && !line.includes(':')) {
      const match = line.match(/^\s+(\d+)\)\s+(.+)$/);
      if (match) {
        const testNum = match[1];
        const testName = match[2].trim();
        output += `${'  '.repeat(indentLevel)}❌ **[${testName}](#failure-${testNum})**\n\n`;
        stats.failing++;
      }
    }
    // Extract test statistics
    else if (line.match(/^\s+(\d+) passing/)) {
      const match = line.match(/^\s+(\d+) passing/);
      if (match) stats.passing = parseInt(match[1]);
    }
    else if (line.match(/^\s+(\d+) failing/)) {
      const match = line.match(/^\s+(\d+) failing/);
      if (match) stats.failing = parseInt(match[1]);
    }
  }
  
  // Add test summary
  output += `\n## Summary\n\n`;
  output += `**${stats.passing} passing**\n\n`;
  output += `**${stats.failing} failing**\n\n`;
  
  // Second pass: Extract failure details
  if (stats.failing > 0) {
    output += `## Failures\n\n`;
    
    // Find the failure section starting line
    let failureStartIndex = -1;
    for (let i = 0; i < filteredLines.length; i++) {
      if (filteredLines[i].match(/^\s*\d+ failing\s*$/)) {
        // Look for the first failure after this line
        for (let j = i + 1; j < filteredLines.length; j++) {
          if (filteredLines[j].match(/^\s*\d+\)\s+/)) {
            failureStartIndex = j;
            break;
          }
        }
        break;
      }
    }
    
    if (failureStartIndex !== -1) {
      let currentFailureNum = '';
      let currentFailureLines = [];
      let inFailure = false;
      
      for (let i = failureStartIndex; i < filteredLines.length; i++) {
        const line = filteredLines[i];
        
        // Check if this is the start of a new failure
        const failureMatch = line.match(/^\s*(\d+)\)\s+(.+)/);
        
        if (failureMatch) {
          // If we were already processing a failure, save it
          if (inFailure && currentFailureLines.length > 0) {
            const failureContent = currentFailureLines.join('\n').trim();
            if (failureContent) {
              output += `<a name="failure-${currentFailureNum}"></a>\n\n`;
              output += `### Failure #${currentFailureNum}\n\n`;
              output += "```\n";
              output += `${currentFailureNum}) ${failureContent}\n`;
              output += "```\n\n";
              output += `[⬆ Back to top](#mocha-test-results)\n\n`;
            }
          }
          
          // Start a new failure
          currentFailureNum = failureMatch[1];
          currentFailureLines = [failureMatch[2]]; // Start with the test name/description
          inFailure = true;
        } 
        else if (inFailure) {
          // Add lines that belong to the current failure
          if (line.trim() !== '') {
            currentFailureLines.push(line);
          } else {
            // Empty line might indicate end of this failure's stack trace
            // Check if the next non-empty line is a new failure
            let nextFailureFound = false;
            for (let j = i + 1; j < filteredLines.length; j++) {
              if (filteredLines[j].trim() === '') continue; // Skip empty lines
              if (filteredLines[j].match(/^\s*\d+\)\s+/)) {
                nextFailureFound = true;
              }
              break;
            }
            
            if (!nextFailureFound && line.trim() === '') {
              // Add the empty line to maintain formatting
              currentFailureLines.push(line);
            }
          }
        }
      }
      
      // Save the last failure if we were processing one
      if (inFailure && currentFailureLines.length > 0) {
        const failureContent = currentFailureLines.join('\n').trim();
        if (failureContent) {
          output += `<a name="failure-${currentFailureNum}"></a>\n\n`;
          output += `### Failure #${currentFailureNum}\n\n`;
          output += "```\n";
          output += `${currentFailureNum}) ${failureContent}\n`;
          output += "```\n\n";
          output += `[⬆ Back to top](#mocha-test-results)\n\n`;
        }
      }
    }
  }
  
  // Write to a file
  fs.writeFileSync('testresults.md', output);
  console.log('Test results markdown generated successfully: testresults.md');
});
