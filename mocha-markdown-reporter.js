// Custom markdown reporter for Mocha
const mocha = require('mocha');

// Extract the constructor
const { 
  Base, 
  Spec
} = mocha;

// Mocha event constants
const EVENT_TEST_PASS = 'pass';
const EVENT_TEST_FAIL = 'fail';
const EVENT_SUITE_BEGIN = 'suite';
const EVENT_SUITE_END = 'suite end';
const EVENT_RUN_BEGIN = 'start';
const EVENT_RUN_END = 'end';

// Define color codes for markdown
const colors = {
  green: '![#00D700](https://placehold.co/15x15/00D700/00D700.png)',
  red: '![#FF0000](https://placehold.co/15x15/FF0000/FF0000.png)',
  grey: '![#A0A0A0](https://placehold.co/15x15/A0A0A0/A0A0A0.png)',
  blue: '![#0000FF](https://placehold.co/15x15/0000FF/0000FF.png)',
  reset: ''
};

// Create the custom reporter
class MarkdownReporter extends Base {
  constructor(runner, options) {
    super(runner, options);
    
    const self = this;
    const output = options.reporterOptions && options.reporterOptions.output;
    
    this.failures = [];
    this.indents = 0;
    this.n = 0;
    this.buf = '# Mocha Test Results\n\n';
    
    // Handle suite events
    runner.on(EVENT_SUITE_BEGIN, (suite) => {
      if (suite.root) return;
      
      // Add some space for better readability
      if (suite.title === 'Chapters API' || suite.title === 'Chats API' || 
          suite.title === 'Messages API' || suite.title === 'Prisons API' ||
          suite.title === 'Prisoners API' || suite.title === 'Rules API' ||
          suite.title === 'User Authentication API') {
        this.buf += '\n';
        this.buf += `## ${suite.title}\n`;
      } else {
        this.indents++;
        this.buf += `${'  '.repeat(this.indents - 1)}### ${suite.title}\n`;
      }
    });
    
    runner.on(EVENT_SUITE_END, (suite) => {
      if (suite.root) return;
      if (!(suite.title === 'Chapters API' || suite.title === 'Chats API' || 
          suite.title === 'Messages API' || suite.title === 'Prisons API' ||
          suite.title === 'Prisoners API' || suite.title === 'Rules API' ||
          suite.title === 'User Authentication API')) {
        this.indents--;
      }
    });
    
    // Handle test events
    runner.on(EVENT_TEST_PASS, (test) => {
      this.n++;
      const indent = '  '.repeat(this.indents);
      this.buf += `${indent}${colors.green} ✓ ${test.title}\n`;
    });
    
    runner.on(EVENT_TEST_FAIL, (test, err) => {
      this.n++;
      const failureNumber = this.failures.length + 1;
      this.failures.push({
        title: test.fullTitle(),
        error: err.message,
        stack: err.stack
      });
      
      const indent = '  '.repeat(this.indents);
      // Create a link from the test title to the failure details at the bottom
      this.buf += `${indent}${colors.red} [✖ ${test.title}](#failure-${failureNumber})\n`;
    });
    
    // Handle the beginning of the test run
    runner.on(EVENT_RUN_BEGIN, () => {
      this.buf += '\n';
    });
    
    // Handle the end of the test run
    runner.on(EVENT_RUN_END, () => {
      const stats = runner.stats;
      
      // Add summary stats
      this.buf += '\n\n';
      this.buf += `**Tests:** ${stats.tests}  `;
      
      if (stats.passes) {
        this.buf += `**Passes:** ${stats.passes}  `;
      }
      
      if (stats.failures) {
        this.buf += `**Failures:** ${stats.failures}  `;
      }
      
      this.buf += `**Duration:** ${stats.duration}ms\n\n`;
      
      // Add failure details with anchors for navigation
      if (this.failures.length) {
        this.buf += '\n\n## Failures\n\n';
        
        this.failures.forEach((failure, i) => {
          const n = i + 1;
          // Create an anchor that we can link to
          this.buf += `<a name="failure-${n}"></a>\n`;
          this.buf += `### ${n}) ${failure.title}\n\n`;
          this.buf += '```\n';
          this.buf += `${failure.error}\n`;
          
          // Clean up stack trace to be more readable
          if (failure.stack) {
            const stackLines = failure.stack.split('\\n');
            const filteredStack = stackLines
              .filter(line => !line.includes('node_modules/mocha'))
              .join('\n');
            
            this.buf += `${filteredStack}\n`;
          }
          
          this.buf += '```\n\n';
          
          // Add a "back to top" link
          this.buf += '[⬆ Back to top](#mocha-test-results)\n\n';
        });
      }
      
      // Output buffer to the console
      process.stdout.write(this.buf);
    });
  }
}

// Export the reporter
module.exports = MarkdownReporter;
