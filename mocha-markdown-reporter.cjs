'use strict';

/**
 * Module dependencies.
 */
const Base = require('mocha/lib/reporters/base');
const utils = require('mocha/lib/utils');

/**
 * Expose `Markdown`.
 */
module.exports = MarkdownReporter;

/**
 * Initialize a new `Markdown` reporter.
 *
 * @param {Runner} runner
 * @param {Object} options
 */
function MarkdownReporter(runner, options) {
  Base.call(this, runner, options);

  let self = this;
  let stats = this.stats;
  let indents = 0;
  let n = 0;
  let buf = '# Mocha Test Results\n\n';
  const failures = [];

  // Define color indicators for markdown
  const green = '![#00D700](https://placehold.co/15x15/00D700/00D700.png)';
  const red = '![#FF0000](https://placehold.co/15x15/FF0000/FF0000.png)';

  // Listen for events
  runner.on('suite', function(suite) {
    if (suite.root) return;

    // Add some space for better readability
    if (suite.title === 'Chapters API' || suite.title === 'Chats API' || 
        suite.title === 'Messages API' || suite.title === 'Prisons API' ||
        suite.title === 'Prisoners API' || suite.title === 'Rules API' ||
        suite.title === 'User Authentication API') {
      buf += '\n';
      buf += '## ' + suite.title + '\n';
    } else {
      ++indents;
      buf += Array(indents).join('  ') + '### ' + suite.title + '\n';
    }
  });

  runner.on('suite end', function(suite) {
    if (suite.root) return;
    if (!(suite.title === 'Chapters API' || suite.title === 'Chats API' || 
        suite.title === 'Messages API' || suite.title === 'Prisons API' ||
        suite.title === 'Prisoners API' || suite.title === 'Rules API' ||
        suite.title === 'User Authentication API')) {
      --indents;
    }
  });

  runner.on('pass', function(test) {
    const indent = Array(indents).join('  ');
    buf += indent + green + ' ✓ ' + test.title + '\n';
  });

  runner.on('fail', function(test, err) {
    const failureNumber = failures.length + 1;
    failures.push({
      title: test.fullTitle(),
      error: err.message,
      stack: err.stack
    });
    
    const indent = Array(indents).join('  ');
    buf += indent + red + ' [✖ ' + test.title + '](#failure-' + failureNumber + ')\n';
  });

  runner.on('end', function() {
    // Add summary stats
    buf += '\n\n';
    buf += '**Tests:** ' + stats.tests + '  ';
    
    if (stats.passes) {
      buf += '**Passes:** ' + stats.passes + '  ';
    }
    
    if (stats.failures) {
      buf += '**Failures:** ' + stats.failures + '  ';
    }
    
    buf += '**Duration:** ' + stats.duration + 'ms\n\n';
    
    // Add failure details with anchors for navigation
    if (failures.length) {
      buf += '\n\n## Failures\n\n';
      
      failures.forEach(function(failure, i) {
        const n = i + 1;
        buf += '<a name="failure-' + n + '"></a>\n';
        buf += '### ' + n + ') ' + failure.title + '\n\n';
        buf += '```\n';
        buf += failure.error + '\n';
        
        // Clean up stack trace
        if (failure.stack) {
          const stackLines = failure.stack.split('\n');
          const filteredStack = stackLines
            .filter(function(line) { 
              return !line.includes('node_modules/mocha'); 
            })
            .join('\n');
          
          buf += filteredStack + '\n';
        }
        
        buf += '```\n\n';
        
        // Add a "back to top" link
        buf += '[⬆ Back to top](#mocha-test-results)\n\n';
      });
    }
    
    process.stdout.write(buf);
  });
}
