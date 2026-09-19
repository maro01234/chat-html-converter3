"""Run against the locally started web server: python3 tests/http_test.py"""
import concurrent.futures
import urllib.error
import urllib.request

BASE = 'http://localhost:10000'

def request(path, body=None, method=None, content_type='text/plain; charset=utf-8'):
    req = urllib.request.Request(BASE + path, data=body, method=method, headers={'Content-Type': content_type})
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()

assert request('/healthz')[2] == b'ok'
assert request('/')[0] == 200
assert request('/app.js')[1]['Content-Type'].startswith('text/javascript')
assert request('/style.css')[0] == 200
assert request('/', method='HEAD')[2] == b''
assert request('/missing')[0] == 404
assert request('/../src/WebServer.java')[0] == 404
assert request('/api/convert')[0] == 405
assert request('/api/convert', b'User:\nhi', content_type='application/json')[0] == 415
assert request('/api/convert', b'')[0] == 400
assert request('/api/convert', b'User:\n\xff')[0] == 400
assert request('/api/convert', b'x' * (2 * 1024 * 1024 + 1))[0] == 413

def convert(index):
    marker = f'Conversation-{index}-unique'
    code, headers, body = request('/api/convert', f'User:\n{marker}\nAssistant:\n**回答**'.encode())
    assert code == 200
    assert headers['Cache-Control'] == 'no-store'
    assert '<strong>回答</strong>' in body.decode()
    assert marker in body.decode()
    assert body.decode().count('Conversation-') == 1

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(convert, range(16)))
print('HTTP tests passed (routes, errors, size limit, concurrent conversions)')
