import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ICONS: Record<string, string> = {
    FORTITUDE: 'https://cdn.discordapp.com/emojis/1212063652031766618.webp',
    ATTACK: 'https://cdn.discordapp.com/emojis/1212063625150468236.webp',
    DEFENSE: 'https://cdn.discordapp.com/emojis/1212063636605116507.webp',
    PROTECTION: 'https://cdn.discordapp.com/emojis/1212063640333590609.webp',
    AMBUSH: 'https://cdn.discordapp.com/emojis/1212063875424452688.webp',
    CRITICAL: 'https://cdn.discordapp.com/emojis/1212063633668964373.webp',
    SPEED: 'https://cdn.discordapp.com/emojis/1212063621723586580.webp',
    BOOST: 'https://cdn.discordapp.com/emojis/1212063630842011678.webp',
    BURNER: 'https://cdn.discordapp.com/emojis/1312034712268832808.webp',
    DECIMATION: 'https://cdn.discordapp.com/emojis/1212063643328577546.webp',
    HACKING: 'https://cdn.discordapp.com/emojis/1212063646541152276.webp',
    LEECH: 'https://cdn.discordapp.com/emojis/1212063612789858395.webp',
    REPAIR: 'https://cdn.discordapp.com/emojis/1212063614698127410.webp',
    REFLECT: 'https://cdn.discordapp.com/emojis/1212063615918546985.webp',
    REVENGE: 'https://cdn.discordapp.com/emojis/1212063617839800361.webp',
    SHIELD: 'https://cdn.discordapp.com/emojis/1212063619739816037.webp',
    CLOAKING: 'https://cdn.discordapp.com/emojis/1212063623661486090.webp',
    ABYSSAL_ASSAULT: 'https://cdn.discordapp.com/emojis/1212063626899357716.webp',
    ABYSSAL_SAFEGUARD: 'https://cdn.discordapp.com/emojis/1212063611531427850.webp',
    ABYSSAL_WARD: 'https://cdn.discordapp.com/emojis/1212063876863238214.webp',
    ABYSSAL_BREACH: 'https://cdn.discordapp.com/emojis/1212064208011657272.webp',
    OMNICORE: 'https://cdn.discordapp.com/emojis/1312034714919505920.webp',
    SWIFTNESS: 'https://cdn.discordapp.com/emojis/1312034718010834965.webp',
    RECOVERY: 'https://cdn.discordapp.com/emojis/1312034716295368785.webp',
    EXPLOIT: 'https://cdn.discordapp.com/emojis/1312034713745227796.webp',
    PIERCER: 'https://cdn.discordapp.com/emojis/1379810146212909097.webp',
    HARDENED: 'https://cdn.discordapp.com/emojis/1379810150465929286.webp',
};

const OUTPUT_DIR = join(process.cwd(), 'public/images/gear-sets');
const force = process.argv.includes('--force');

mkdirSync(OUTPUT_DIR, { recursive: true });

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const [key, url] of Object.entries(ICONS)) {
    const filename = `${key.toLowerCase()}.webp`;
    const outputPath = join(OUTPUT_DIR, filename);

    if (!force && existsSync(outputPath)) {
        console.log(`  skip  ${filename}`);
        skipped++;
        continue;
    }

    const response = await fetch(url);
    if (!response.ok) {
        console.error(`  FAIL  ${key}: HTTP ${response.status}`);
        failed++;
        continue;
    }

    try {
        writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
        console.log(`  ok    ${filename}`);
        downloaded++;
    } catch (err) {
        console.error(`  FAIL  ${key}: write error – ${(err as Error).message}`);
        failed++;
    }
}

console.log(`\nDone: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`);
