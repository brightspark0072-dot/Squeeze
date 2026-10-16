# Test server that behaves like GitHub Pages (files/folders starting with _ or . are not served).
# Usage: python3 tests/serve.py PORT DIR [flaky-file]
# If "flaky-file" is given and the file DIR/../flaky.flag exists, that path is sent truncated (to test interrupted downloads).
import http.server, sys, os
PORT, ROOT = int(sys.argv[1]), os.path.abspath(sys.argv[2]); FLAKY = sys.argv[3] if len(sys.argv) > 3 else None
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if any(s.startswith(('_', '.')) for s in path.split('/') if s):
            return self.send_error(404)
        if FLAKY and path.endswith(FLAKY) and os.path.exists(os.path.join(ROOT, '..', 'flaky.flag')):
            data = open(os.path.join(ROOT, path.lstrip('/')), 'rb').read()
            self.send_response(200); self.send_header('Content-Length', str(len(data))); self.send_header('Content-Type', 'application/javascript'); self.end_headers()
            self.wfile.write(data[:len(data) // 3]); self.wfile.flush(); self.close_connection = True
            self.connection.shutdown(2); return
        super().do_GET()
    def log_message(self, *a): pass
os.chdir(ROOT); http.server.ThreadingHTTPServer(('', PORT), H).serve_forever()
