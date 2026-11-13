import { tileColor, tileInitials } from '../project-tile.ts';

const shell = document.documentElement.dataset;
document.documentElement.lang = shell.shellLang === 'ru' ? 'ru' : 'en';
const name = shell.shellProject || '';
const project = document.getElementById('project-name');
project.textContent = name;
project.title = name;
const tile = document.getElementById('project-tile');
tile.dataset.initials = tileInitials(name);
tile.style.setProperty('--tile', tileColor(name));
document.getElementById('opening-label').textContent = shell.shellOpening || '';
const back = document.getElementById('return-to-start');
back.textContent = shell.shellReturn || '';
void window.prepareDeckmatePage().then(() => {
  setTimeout(() => { back.hidden = false; }, 4000);
});
