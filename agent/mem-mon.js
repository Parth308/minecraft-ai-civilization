const fs = require('fs');
const TARGET_PID = parseInt(process.argv[2], 10);
const CHECK_INTERVAL = 3000;
const RSS_LIMIT_KB = 850 * 1024;

if (!TARGET_PID || isNaN(TARGET_PID)) {
  process.stderr.write('[MEM-MON] No target PID provided\n');
  process.exit(1);
}

process.stderr.write(`[MEM-MON] Monitoring PID ${TARGET_PID}, threshold ${RSS_LIMIT_KB}KB, interval ${CHECK_INTERVAL}ms\n`);

const timer = setInterval(() => {
  try {
    const status = fs.readFileSync(`/proc/${TARGET_PID}/status`, 'utf8');
    const rssMatch = status.match(/VmRSS:\s+(\d+)/);
    if (rssMatch) {
      const rssKB = parseInt(rssMatch[1], 10);
      process.stderr.write(`[MEM-MON] PID ${TARGET_PID} rss=${rssKB}KB\n`);
      if (rssKB > RSS_LIMIT_KB) {
        process.stderr.write(`[MEM-MON] PID ${TARGET_PID} rss=${rssKB}KB > ${RSS_LIMIT_KB}KB — SIGKILL\n`);
        try { process.kill(TARGET_PID, 'SIGKILL'); } catch (e) {
          process.stderr.write(`[MEM-MON] kill failed: ${e.message}\n`);
        }
        clearInterval(timer);
      }
    } else {
      process.stderr.write(`[MEM-MON] PID ${TARGET_PID} not found — exiting\n`);
      clearInterval(timer);
    }
  } catch (e) {
    process.stderr.write(`[MEM-MON] Error: ${e.message}\n`);
  }
}, CHECK_INTERVAL);
