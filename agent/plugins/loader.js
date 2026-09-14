/**
 * Plugin Loader — Centralized mineflayer plugin loading with error isolation.
 *
 * Each plugin is wrapped in its own try/catch so a single failure never
 * crashes the agent. Loaded plugins are exposed via a manifest object
 * so actuation modules can check availability at runtime.
 *
 * Load order matters:
 *  1. pathfinder (already loaded by index.js, skip here)
 *  2. baritone (wraps pathfinder with smarter pathing)
 *  3. armor-manager
 *  4. tool (auto tool selection)
 *  5. pvp (combat helper)
 *  6. statemachine (behavior trees)
 *  7. collectblock (already loaded by index.js, skip here)
 *  8. auto-eat (already loaded by index.js, skip here)
 */

const logger = require('../../shared/logger');

/**
 * Load all available mineflayer plugins onto `bot`.
 * Returns a manifest: { name: boolean } indicating what loaded.
 */
async function loadPlugins(bot) {
  const manifest = {};

  // ── 1. Baritone (enhanced pathfinding) ────────────────────────────────────
  // Call loader directly — mineflayer.loadPlugin swallows errors silently,
  // and baritone's inject(bot, {useCustomPhysics}) throws when opts is undefined.
  try {
    const { loader: baritoneLoader } = require('@miner-org/mineflayer-baritone');
    baritoneLoader(bot, {});
    manifest.baritone = !!bot.ashfinder;
    logger.info('Plugins', `✓ baritone — enhanced pathfinding active (ashfinder: ${manifest.baritone})`);
  } catch (err) {
    manifest.baritone = false;
    logger.warn('Plugins', `✗ baritone unavailable: ${err.message}`);
  }

  // ── 2. Armor Manager (auto-equip best armor) ─────────────────────────────
  try {
    const armorManager = require('mineflayer-armor-manager');
    bot.loadPlugin(armorManager);
    manifest.armorManager = true;
    logger.info('Plugins', '✓ armor-manager — auto armor equipping active');
  } catch (err) {
    manifest.armorManager = false;
    logger.warn('Plugins', `✗ armor-manager unavailable: ${err.message}`);
  }

  // ── 3. Tool (automatic best-tool selection for blocks) ────────────────────
  try {
    const { plugin: toolPlugin } = require('mineflayer-tool');
    bot.loadPlugin(toolPlugin);
    manifest.tool = true;
    logger.info('Plugins', '✓ tool — auto tool selection active');
  } catch (err) {
    manifest.tool = false;
    logger.warn('Plugins', `✗ tool unavailable: ${err.message}`);
  }

  // ── 4. PVP (combat helper — swings, strafes, cooldowns) ──────────────────
  try {
    const { plugin: pvpPlugin } = require('mineflayer-pvp');
    bot.loadPlugin(pvpPlugin);
    manifest.pvp = true;
    logger.info('Plugins', '✓ pvp — combat helper active');
  } catch (err) {
    manifest.pvp = false;
    logger.warn('Plugins', `✗ pvp unavailable: ${err.message}`);
  }

  // ── 5. State Machine (behavior-tree-like state control) ──────────────────
  try {
    const { BotStateMachine } = require('mineflayer-statemachine');
    bot.loadPlugin(BotStateMachine);
    manifest.stateMachine = true;
    logger.info('Plugins', '✓ statemachine — behavior state machine active');
  } catch (err) {
    manifest.stateMachine = false;
    logger.warn('Plugins', `✗ statemachine unavailable: ${err.message}`);
  }

  // Attach manifest to bot so actuation modules can check plugin availability
  bot.pluginManifest = manifest;

  const loaded = Object.values(manifest).filter(Boolean).length;
  const total = Object.keys(manifest).length;
  logger.info('Plugins', `Plugin loading complete: ${loaded}/${total} loaded`);

  return manifest;
}

module.exports = { loadPlugins };
