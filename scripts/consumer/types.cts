import { parseMessages } from 'n3.js-messages';

const count: number = parseMessages('', { format: 'TriG' }).length;
void count;
