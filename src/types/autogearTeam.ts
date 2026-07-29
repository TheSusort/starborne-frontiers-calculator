/**
 * A saved Autogear ship selection. Order matters: index 0 gets first pick of
 * the gear inventory when autogear runs.
 *
 * `shipIds` deliberately has no foreign key to `ships` — ship rows are replaced
 * on re-import, and a team surviving as a partially resolvable list beats a
 * cascade silently emptying it.
 */
export interface AutogearTeam {
    id: string;
    name: string;
    shipIds: string[];
    createdAt: number;
}
