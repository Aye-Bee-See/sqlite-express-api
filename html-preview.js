// Simple HTML preview generator for markdown test results
import fs from 'fs';

const markdownContent = fs.readFileSync('testresults.md', 'utf8');

// Simple markdown to HTML conversion for testing links
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Mocha Test Results</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #2d3748; border-bottom: 3px solid #4299e1; padding-bottom: 10px; }
        h2 { color: #4a5568; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 40px; }
        h3 { color: #718096; margin-top: 30px; }
        pre { 
            background-color: #f7fafc; 
            padding: 15px; 
            border-radius: 6px; 
            border-left: 4px solid #4299e1;
            overflow-x: auto;
        }
        code { 
            background-color: #edf2f7; 
            padding: 2px 4px; 
            border-radius: 3px; 
            font-size: 0.9em;
        }
        .passing { color: #38a169; }
        .failing { color: #e53e3e; font-weight: bold; }
        .summary { 
            background-color: #f0fff4; 
            padding: 20px; 
            border-radius: 6px; 
            border-left: 4px solid #38a169; 
            margin: 20px 0;
        }
        .failures-section {
            background-color: #fffaf0;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #ed8936;
            margin: 20px 0;
        }
        a { color: #4299e1; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .back-link { 
            display: inline-block; 
            margin-top: 15px; 
            padding: 8px 15px; 
            background-color: #4299e1; 
            color: white; 
            border-radius: 4px; 
            text-decoration: none;
        }
        .back-link:hover { background-color: #3182ce; }
    </style>
</head>
<body>
    <div class="container">
        ${markdownContent
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/\`\`\`([^`]+)\`\`\`/gs, '<pre><code>$1</code></pre>')
            .replace(/\`([^`]+)\`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            .replace(/<a name="([^"]+)"><\/a>/g, '<a name="$1"></a>')
            .replace(/    ✅ (.+)/g, '<div class="passing">    ✅ $1</div>')
            .replace(/    ❌ (.+)/g, '<div class="failing">    ❌ $1</div>')
            .replace(/^(.+)$/gm, function(match, line) {
                if (line.includes('passing') && line.includes('**')) {
                    return '<div class="summary">' + line + '</div>';
                }
                if (line.includes('failing') && line.includes('**')) {
                    return '<div class="summary">' + line + '</div>';
                }
                if (line.includes('## Failures')) {
                    return '<div class="failures-section"><h2>Failures</h2>';
                }
                if (line.includes('⬆ Back to top')) {
                    return line.replace(/\[([^\]]+)\]\(([^)]+)\)/, '<a href="$2" class="back-link">$1</a>') + '</div>';
                }
                return line;
            })
            .replace(/\n/g, '<br>\n')
        }
    </div>
</body>
</html>
`;

fs.writeFileSync('testresults.html', htmlContent);
console.log('HTML preview generated: testresults.html');
