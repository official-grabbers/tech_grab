const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const runWappalyzer = require("./src/cli");
const { exec } = require("child_process");
const bodyParser = require("body-parser");
const socketio = require('socket.io');

const app = express();
const processingQueue = {};
// Set EJS as the view engine
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use('/results', express.static('results'));
app.use(bodyParser.urlencoded({ extended: true }));

// Multer storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        const fileId = uuidv4(); // Generate unique ID for the file
        cb(null, `${fileId}.csv`);
    },
});

const upload = multer({ storage: storage }).single("file");
// const processingQueue = new Bull('processing-queue');

app.post("/bulk-stack", async (req, res) => {
    upload(req, res, function (err) {
        if (err) {
            console.error(err);
            return res.status(500).send("Error uploading file");
        }

        if (!req.file) {
            return res.status(400).send("No file provided");
        }
        // Retrieve file name and file path
        const fileName = req.file.filename;
        const filePath = req.file.path;

        // Start background process
        const processId = startBackgroundProcess(fileName, filePath);

        // Store process ID for tracking progress
        processingQueue[fileName] = { progress: 0,  socketId: null  };
        io.emit('processId', { fileName, processId });

        const data = {
            message: "CSV uploaded successfully!",
            fileName,
            filePath,
            processId,
        }
        res.render("upload", { data });
    });
});

// Start background process
function startBackgroundProcess(fileName, filePath) {
    const processId = uuidv4(); // Generate unique ID for the process
    const process = exec(`node process-csv.js ${fileName} ${filePath}`);

    // Set maximum listeners to prevent EventEmitter memory leaks
    process.setMaxListeners(20);

    process.stdout.on("data", (data) => {
        console.log(`stdout: ${data}`);
        // Update progress
        if (data.includes("Progress:")) {
            const progress = parseInt(data.split(":")[1]);
            if (processingQueue[fileName]) {
                processingQueue[fileName].progress = progress;
                if (processingQueue[fileName].socketId) {
                    io.to(processingQueue[fileName].socketId).emit('progress', { progress });
                }
            }
        }
    });

    process.stderr.on("data", (data) => {
        console.error(`stderr: ${data}`);
    });

    process.on("close", (code) => {
        console.log(`child process exited with code ${code}`);
        delete processingQueue[fileName]; // Remove from processing queue on completion
        io.emit('processingComplete', { fileName });
    });

    return processId;
}


// Define a route to render the EJS template
app.get("/", (req, res) => {
    res.render("index");
});

// Define a basic GET request handler
app.get("/tech-stack", (req, res) => {
    res.render("example");
});

app.get("/bulk-stack", (req, res) => {
    res.render("upload", { data: { fileName: null } }); // Pass an empty data object or with default values
});

app.get("/contact-us", (req, res) => {
  res.render("contact");
});

app.post("/tech-stack", async (req, res) => {
    try {
        const website_url = req.body.website;
        const technologies = await runWappalyzer(website_url);

        const results = {
            url: website_url,
            technologies: technologies,
        };

        res.render("example", { results });
    } catch (error) {
        res.render("example", { error: error.message || String(error) });
    }
});

const port = 8888;

const io = socketio(
    app.listen(port, () => {
        console.log(`Server running at ${port}`);
    })
);

// WebSocket connection
io.on('connection', (socket) => {
    socket.on('register', (data) => {
        if (processingQueue[data.fileName]) {
            processingQueue[data.fileName].socketId = socket.id;
        }
    });
});