import pc from 'picocolors';
import { ModelService } from '../services/ModelService.js';
import { spawnServe, waitForReady, stopAll, getAuthForPort } from '../services/ServeManager.js';
import { SessionManager } from '../services/SessionManager.js';
import { SSEClient } from '../services/SSEClient.js';
import { discoverProjects, getOpenCodeConfigPath } from '../services/ConfigService.js';

export async function runConnectionTest(): Promise<void> {
  const div = pc.dim('─'.repeat(52));
  console.log('');
  console.log(div);
  console.log(`  ${pc.bold(pc.cyan('opencode-remote-telegram'))} ${pc.dim('connection test')}`);
  console.log(div);

  // ── 1. Config ───────────────────────────────────────────────────────────────
  const configPath = getOpenCodeConfigPath();
  if (configPath) {
    console.log(`  ${pc.green('✓')} Config: ${pc.dim(configPath)}`);
  } else {
    console.log(`  ${pc.yellow('⚠')} No global opencode.json configured`);
  }

  // ── 2. Projects ─────────────────────────────────────────────────────────────
  const projects = discoverProjects();
  if (projects.length > 0) {
    console.log(`  ${pc.green('✓')} Projects: ${projects.length} found`);
  } else {
    console.log(`  ${pc.red('✗')} No projects found — check PROJECTS_BASE_PATH in setup`);
    console.log(div);
    process.exit(1);
  }

  // ── 3. Models ───────────────────────────────────────────────────────────────
  console.log(`  ${pc.dim('…')} Loading models...`);
  const models = ModelService.getModels();
  if (models.length > 0) {
    const providers = [...new Set(models.map(m => m.split('/')[0]))];
    console.log(`  ${pc.green('✓')} Models: ${models.length} loaded (${providers.join(', ')})`);
  } else {
    console.log(`  ${pc.red('✗')} No models found — is opencode installed and in PATH?`);
    console.log(div);
    process.exit(1);
  }

  // ── 4. Serve + Session ──────────────────────────────────────────────────────
  const testProject = projects[0];
  console.log(`  ${pc.dim('…')} Starting opencode serve for "${testProject.alias}"...`);

  try {
    const port = await spawnServe(testProject.path);
    await waitForReady(port, testProject.path, 20_000);
    console.log(`  ${pc.green('✓')} Server ready on port ${port}`);

    const sessionId = await SessionManager.create(port);
    console.log(`  ${pc.green('✓')} Session created: ${pc.dim(sessionId)}`);

    // ── 5. Prompt test ──────────────────────────────────────────────────────
    console.log(`  ${pc.dim('…')} Sending test prompt "Say: HELLO"...`);

    const sseClient = new SSEClient();
    let response = '';
    let done = false;

    sseClient.onText(delta => { response += delta; });
    sseClient.onIdle(() => { done = true; sseClient.disconnect(); });
    sseClient.onError((_sid, err) => {
      const msg = err.data?.message ?? err.name;
      // Model not found is ok — it means the serve works but the model ID doesn't match
      if (msg?.includes('Model not found')) {
        console.log(`  ${pc.yellow('⚠')} Model not found — retrying without model ID...`);
        // Retry without model
        SessionManager.sendPrompt(port, sessionId, 'Say: HELLO').catch(() => {});
        return;
      }
      console.log(`  ${pc.red('✗')} Error: ${msg}`);
      done = true;
      sseClient.disconnect();
    });

    sseClient.connect(`http://127.0.0.1:${port}`, port);

    // Small delay to let SSE connect
    await new Promise(r => setTimeout(r, 300));
    await SessionManager.sendPrompt(port, sessionId, 'Say: HELLO');

    // Wait up to 30s
    const start = Date.now();
    while (!done && Date.now() - start < 30_000) {
      await new Promise(r => setTimeout(r, 500));
    }

    sseClient.disconnect();

    if (response.length > 0) {
      console.log(`  ${pc.green('✓')} Response received: "${response.slice(0, 80).trim()}"`);
    } else if (done) {
      console.log(`  ${pc.yellow('⚠')} Session completed but no text response (may still be OK for tool-only responses)`);
    } else {
      console.log(`  ${pc.red('✗')} Timeout — no response within 30 seconds`);
    }

  } catch (err) {
    console.log(`  ${pc.red('✗')} ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    stopAll();
  }

  console.log(div);
  console.log(`  ${pc.dim('To enable debug logging, start with:')} ${pc.cyan('DEBUG=1 opencode-remote-telegram start')}`);
  console.log('');
}
