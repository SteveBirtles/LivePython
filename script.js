import { loadPyodide } from "./pyodide/pyodide.mjs";

function escapeHtml(unsafeString) {
    return unsafeString
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function main() {
    
    // Get references to DOM elements
    const syntaxErrorsDiv = document.getElementById("syntax-errors");
    const outputArea = document.getElementById("output");
    const runButton = document.getElementById("run-button");
    runButton.style.visibility = "hidden";

    // Initialize Pyodide
    const pyodide = await loadPyodide();

    // Initialize CodeMirror editor
    const codeMirrorEditor = CodeMirror(document.getElementById("python-code"), {
        mode: "python",
        theme: "dracula",
        lineNumbers: true,
        gutters: ["CodeMirror-lint-markers"],
        lint: {
            async: true, // We're using an async linter
            getAnnotations: pythonLint
        }
    });

    // Function to check syntax and provide linting annotations
    async function pythonLint(text, updateLinting, options, cm) {
        let annotations = [];
        syntaxErrorsDiv.style.display = "none"; // Hide error box by default
        runButton.style.visibility = "visible";
        runButton.disabled = false; // Enable run button by default
        document.getElementById("loading").hidden = true;

        try {
            // Set the user's code in the Python environment
            pyodide.globals.set("user_code", text);

            // Define the check_syntax function in Python
            const code = `
def check_syntax(code):
    import ast
    try:
        ast.parse(code)
    except SyntaxError as e:
        return {'lineno': e.lineno, 'offset': e.offset, 'message': e.msg}
    return None

result = check_syntax(user_code)
`;
            // Run the code
            pyodide.runPython(code);

            // Get the result
            const result = pyodide.globals.get('result');
            if (result !== undefined && result !== null) {
                const lineNumber = result.get('lineno') - 1; // Zero-indexed
                const columnNumber = result.get('offset') ? result.get('offset') - 1 : 0; // Zero-indexed
                const message = result.get('message');

                annotations.push({
                    from: CodeMirror.Pos(lineNumber, columnNumber),
                    to: CodeMirror.Pos(lineNumber),
                    message: message,
                    severity: "error"
                });

                // Display error message in the syntax errors box
                syntaxErrorsDiv.textContent = `Line ${result.get('lineno')}, Column ${result.get('offset')}: ${message}`;
                syntaxErrorsDiv.style.display = "block"; // Show error box

                runButton.disabled = true; // Disable run button

                result.destroy(); // Destroy PyProxy to prevent memory leak
            }
        } catch (err) {
            // Handle other errors
            console.error(err);
        }
        updateLinting(annotations);
    }

    // Event listener for the Run Code button
    runButton.addEventListener("click", async () => {
        const code = codeMirrorEditor.getValue();
        outputArea.textContent = ""; // Clear previous output

        // Hide the run button when code is running
        runButton.classList.add('hidden');

        // Code is already syntax-checked before enabling the run button
        try {
            // Redirect stdout and stderr to capture the output
            pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = sys.stderr = StringIO()
`);

            // Execute the user's code
            await pyodide.runPythonAsync(`
code = user_code
try:
    exec(code, globals())
except Exception:
    import traceback
    traceback.print_exc()
`);

            // Retrieve the output from stdout
            const output = pyodide.runPython('sys.stdout.getvalue()');
            const outputLines = output.split("\n")
            
            let errorHasOccurred = false;
            outputArea.innerHTML = "";
            for (let line of outputLines) {
                if (line.trim() == 'Traceback (most recent call last):' ||
                    line.trim() ==  'File "<exec>", line 4, in <module>') {
                    errorHasOccurred = true;
                    continue;
                } else if (line.trim().startsWith('File "<string>", line')) {
                    const lineInfo = line.split(",")[1].trim();
                    outputArea.innerHTML += "<hr /><span style='color:red'>Error on " + escapeHtml(lineInfo) + ":</span><br />";
                    continue;
                }
                if (errorHasOccurred) {
                    outputArea.innerHTML += "<span style='color:red'>" + escapeHtml(line) + "</span><br />";
                } else {
                    outputArea.innerHTML += escapeHtml(line) + "<br />";
                }
            }
        } catch (err) {
            outputArea.innerHTML = "Sorry, unable to run code...<br />" + err.toString();
        } finally {
            // Reset stdout and stderr to their original states
            pyodide.runPython(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
`);
        }
    });

    // Event listener for code changes
    codeMirrorEditor.on('change', () => {
        // Show the run button when the user edits the code
        if (codeMirrorEditor.getValue().trim().length > 0) {
            runButton.classList.remove('hidden');
        }
    });
}

// Start the main function
main();
