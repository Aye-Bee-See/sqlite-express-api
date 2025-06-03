# Mocha Test Reporter - Usage Guide

This project includes a custom Mocha test reporter that generates beautifully formatted markdown and HTML output with clickable navigation between failed tests and their detailed error information.

## 🚀 Available Test Scripts

### Quick Test Commands
```bash
# Run tests with enhanced markdown output
npm run test:enhanced

# Generate both markdown and HTML reports
npm run test:report

# Standard test run (saves raw output to testresults.txt)
npm test

# Original markdown formatter (legacy)
npm run test:markdown
```

## 📊 Features

### ✅ **Enhanced Test Results Display**
- **Passing tests** with green checkmarks (✅)
- **Failed tests** with red X marks (❌) and **clickable links**
- Clean section organization by API endpoints
- Test summary with pass/fail counts

### 🔗 **Interactive Navigation**
- **Clickable links** from failed test names to detailed error information
- **Back to top** links from each failure for easy navigation
- **HTML preview** with styled formatting for better readability

### 📝 **Detailed Error Information**
- Complete stack traces with file paths and line numbers
- Error messages preserved exactly as Mocha outputs them
- Clean code block formatting for easy reading

## 📁 Generated Files

When you run the test reporter, it creates:

- **`testresults.md`** - Markdown formatted test results
- **`testresults.html`** - HTML preview with styling and working links
- **`testresults.txt`** - Raw Mocha output (from `npm test`)

## 🎯 Example Output Structure

```markdown
# Mocha Test Results

## Chapters API

### POST /chapter/chapter
    ✅ should create a new chapter successfully
    ✅ should return error if name is missing

### GET /chapter/chapter?id=:id
    ✅ should return a single chapter if ID is valid
    ❌ **[should return error if ID is invalid](#failure-1)**

## Summary
**51 passing**
**27 failing**

## Failures

### Failure #1
\`\`\`
1) Chapters API
   GET /chapter/chapter?id=:id
   should return error if ID is invalid:
   AssertionError: expected undefined to be false
   at Test.<anonymous> (test/chapter.api.test.js:318:51)
   ...stack trace...
\`\`\`
[⬆ Back to top](#mocha-test-results)
```

## 🛠 Technical Details

### Files Involved
- **`enhanced-formatter.js`** - Main formatter script that processes Mocha output
- **`html-preview.js`** - Converts markdown to styled HTML
- **`format-test-results.js`** - Legacy formatter (still available)

### How It Works
1. Mocha runs with `--reporter spec` to get structured output
2. Output is piped to `enhanced-formatter.js`
3. Formatter parses test results and creates clickable markdown
4. HTML generator creates a styled preview with working navigation

### Customization
The formatter automatically:
- Filters out database connection noise
- Groups tests by API sections and HTTP endpoints
- Creates anchor links for failed tests
- Preserves complete stack traces and error details

## 🎨 HTML Preview Features

The HTML preview includes:
- Modern, clean styling
- Syntax highlighting for code blocks
- Responsive design
- Smooth scrolling navigation
- Color-coded test results (green/red)

## 📚 Usage Examples

### Generate Full Report
```bash
npm run test:report
```
This will:
1. Run all tests with enhanced formatting
2. Generate `testresults.md`
3. Create `testresults.html` with styling
4. Show success message

### View Results
- **Markdown**: Open `testresults.md` in any markdown viewer
- **HTML**: Open `testresults.html` in browser or use VS Code's Simple Browser
- **Raw**: Check `testresults.txt` for unformatted Mocha output

### Integration with CI/CD
The markdown output is perfect for:
- GitHub PR comments
- GitLab merge request reports
- Slack/Teams notifications
- Documentation generation

Happy testing! 🧪✨
