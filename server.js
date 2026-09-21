const http = require("http");
const fs = require("fs");
const path = require("path");
const mcp = require("./api/mcp.js");

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url.split("?")[0] === "/api/mcp") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      req.body = body ? JSON.parseSafe ? null : body : undefined;

      const response = {
        statusCode: 200,
        headers: {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader(key, value) {
          this.headers[key] = value;
          return this;
        },
        end(data) {
          if (!res.headersSent) res.writeHead(this.statusCode, this.headers);
          res.end(data);
        }
      };

      mcp(req, response);
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ChessGame MCP listening on 0.0.0.0:${PORT}`);
});
