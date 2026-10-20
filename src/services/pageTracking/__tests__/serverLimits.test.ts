import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MAX_CLICK_KEYS, TRACK_ID_PATTERN } from '../clicks';
import {
    MAX_ERRORS_PER_FLUSH,
    MAX_MESSAGE_LENGTH,
    MAX_STACK_LENGTH,
    MAX_VISITS_PER_FLUSH,
} from '../tracker';

const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261020000001_page_tracking.sql'),
    'utf8'
);

describe('client limits match the track_page_events migration', () => {
    it('track id pattern', () => {
        expect(sql).toContain(`'${TRACK_ID_PATTERN.source}'`);
    });
    it('click key limit', () => {
        expect(sql).toContain(`LIMIT ${MAX_CLICK_KEYS}`);
    });
    it('visits and errors per flush', () => {
        expect(sql).toContain(`least(${MAX_VISITS_PER_FLUSH},`);
        expect(sql).toContain(`least(${MAX_ERRORS_PER_FLUSH},`);
    });
    it('message and stack lengths', () => {
        expect(sql).toContain(`left(coalesce(e->>'message', ''), ${MAX_MESSAGE_LENGTH})`);
        expect(sql).toContain(`left(coalesce(e->>'stack', ''), ${MAX_STACK_LENGTH})`);
    });
    it('device values', () => {
        expect(sql).toContain(`IN ('mobile', 'tablet', 'desktop')`);
    });
    it('cron instruction line', () => {
        expect(sql).toContain(`cron.schedule('rollup-page-tracking'`);
    });
});
