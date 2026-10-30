import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const isWindows = process.platform === 'win32';
const pythonSubPath = isWindows ? join('Scripts', 'python.exe') : join('bin', 'python');

const candidates = [
	resolve(rootDir, 'backend', '.venv', pythonSubPath),
	resolve(rootDir, '.venv', pythonSubPath),
	isWindows ? 'python' : 'python3'
];

let pythonExe = candidates.find((candidate) => {
	if (candidate === 'python' || candidate === 'python3') return true;
	return existsSync(candidate);
}) || (isWindows ? 'python' : 'python3');

const args = [
	'-m',
	'uvicorn',
	'server:app',
	'--app-dir',
	'backend',
	'--host',
	'127.0.0.1',
	'--port',
	'8000',
	'--reload',
	...process.argv.slice(2)
];

const child = spawn(pythonExe, args, {
	stdio: 'inherit',
	cwd: rootDir
});

child.on('error', (err) => {
	console.error(`Failed to start backend server with "${pythonExe}":`, err.message);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
	} else {
		process.exit(code ?? 0);
	}
});
