// AUTO-GENERATED from VideoNote src/renderer/themes.js + chrome-themes.js
// (palettes transcribed from the two research reports: deep-research-report.md
// and "Transcript App Low-Strain Themes.md"). Regenerate with the gen script;
// do not hand-edit palettes.
//
// Each theme: reading pane palette (bg/fg/textDim/hoverBg/sentBg/sentText/
// wordBg/wordText + 4 category colors) and a full UI-chrome palette so EVERY
// surface (toolbar, panels, popovers, modals, highlights, scrollbars) follows
// the theme. Applied by applyTheme()/applyChrome() in util.js.

const EXTENDED_THEMES = {
  'gruvbox-retro-dark': {
    id: 'gruvbox-retro-dark', name: 'Gruvbox Retro Dark', group: 'Dark', overall: 91.5,
    bg: '#1d2021', fg: '#dfaf87', textDim: '#928374', hoverBg: '#282828',
    sentBg: '#3c3836', sentText: '#fbf1c7', wordBg: '#fabd2f', wordText: '#1d2021',
    catNote: '#83a598', catRule: '#fe8019', catKey: '#b8bb26', catNever: '#fb4934',
    chrome: { chromeBg: '#1D1F20', chromeFg: '#BABDC1', chromeLine: '#464748', chromeHover: '#232526', panelBg: '#171819', titlebarBg: '#222425', btnBg: '#1C1D1E', accent: '#B08A5A', accentHover: '#BA9669', textDim: '#909396', textMuted: '#808386', scrollbar: '#414244', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#1A1B1C', modalBorder: '#5F6060', hlItemBg: '#181819', hlSelBg: '#69553B', hlSelBorder: '#C2A37B' },
  },
  'nord-polar': {
    id: 'nord-polar', name: 'Nord Polar', group: 'Dark', overall: 89,
    bg: '#2e3440', fg: '#d8dee9', textDim: '#7f8999', hoverBg: '#3b4252',
    sentBg: '#434c5e', sentText: '#eceff4', wordBg: '#88c0d0', wordText: '#2e3440',
    catNote: '#81a1c1', catRule: '#d18a74', catKey: '#a3be8c', catNever: '#cf888f',
    chrome: { chromeBg: '#31353C', chromeFg: '#D6DADE', chromeLine: '#585B61', chromeHover: '#353941', panelBg: '#2B2E35', titlebarBg: '#33373F', btnBg: '#2E3239', accent: '#7F9BB6', accentHover: '#8EA8C0', textDim: '#A5A9AE', textMuted: '#94979C', scrollbar: '#565A60', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#2D3138', modalBorder: '#6F7176', hlItemBg: '#2B2E36', hlSelBg: '#58687A', hlSelBorder: '#9CB2C8' },
  },
  'deep-slate-charcoal': {
    id: 'deep-slate-charcoal', name: 'Deep Slate Charcoal', group: 'Dark', overall: 86.5,
    bg: '#121314', fg: '#cbcbcb', textDim: '#737578', hoverBg: '#1e2022',
    sentBg: '#2d3033', sentText: '#f1f3f5', wordBg: '#90e0ef', wordText: '#121314',
    catNote: '#56b4e9', catRule: '#e69f00', catKey: '#009e73', catNever: '#cc79a7',
    chrome: { chromeBg: '#151617', chromeFg: '#B2B5B8', chromeLine: '#414243', chromeHover: '#171717', panelBg: '#090909', titlebarBg: '#171818', btnBg: '#0F0F0F', accent: '#718898', accentHover: '#7F95A4', textDim: '#87898B', textMuted: '#787A7C', scrollbar: '#333435', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#0D0D0D', modalBorder: '#585858', hlItemBg: '#0A0A0A', hlSelBg: '#414D56', hlSelBorder: '#8EA2AF' },
  },
  'solarized-dark': {
    id: 'solarized-dark', name: 'Solarized Dark', group: 'Dark', overall: 85,
    bg: '#002b36', fg: '#a8b4b5', textDim: '#6a7e84', hoverBg: '#073642',
    sentBg: '#0a3a44', sentText: '#fdf6e3', wordBg: '#b58900', wordText: '#002b36',
    catNote: '#3694d5', catRule: '#d67147', catKey: '#859900', catNever: '#e56462',
    chrome: { chromeBg: '#171D1E', chromeFg: '#B4B9BC', chromeLine: '#414646', chromeHover: '#1F2628', panelBg: '#151B1C', titlebarBg: '#1B2324', btnBg: '#181E1F', accent: '#5A8E99', accentHover: '#659CA7', textDim: '#919599', textMuted: '#808487', scrollbar: '#3E4446', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#171D1E', modalBorder: '#5E6262', hlItemBg: '#151A1B', hlSelBg: '#3A585F', hlSelBorder: '#77A8B2' },
  },
  'nord-dusk': {
    id: 'nord-dusk', name: 'Nord Dusk', group: 'Dark', overall: 84,
    bg: '#2E3440', fg: '#D8DEE9', textDim: '#9AA5B1', hoverBg: '#3B4252',
    sentBg: '#4C566A', sentText: '#ECEFF4', wordBg: '#D1C1A3', wordText: '#2E3440',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#31353C', chromeFg: '#D6DADE', chromeLine: '#585B61', chromeHover: '#353941', panelBg: '#2B2E35', titlebarBg: '#33373F', btnBg: '#2E3239', accent: '#8A95B2', accentHover: '#99A3BD', textDim: '#A5A9AE', textMuted: '#94979C', scrollbar: '#565A60', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#2D3138', modalBorder: '#6F7176', hlItemBg: '#2B2E36', hlSelBg: '#5E6578', hlSelBorder: '#A5AEC5' },
  },
  'dracula-muted': {
    id: 'dracula-muted', name: 'Dracula Muted', group: 'Dark', overall: 79,
    bg: '#282A36', fg: '#D2D5DD', textDim: '#98A0B2', hoverBg: '#343746',
    sentBg: '#505872', sentText: '#F4F5F1', wordBg: '#CFBF97', wordText: '#282A36',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#2A2C33', chromeFg: '#C8CCD0', chromeLine: '#505258', chromeHover: '#2D2F36', panelBg: '#222429', titlebarBg: '#2C2E36', btnBg: '#26282E', accent: '#8E87B8', accentHover: '#9C96C3', textDim: '#9B9EA3', textMuted: '#898C91', scrollbar: '#4C4F54', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#25272D', modalBorder: '#67686B', hlItemBg: '#23252A', hlSelBg: '#5C5976', hlSelBorder: '#A8A3CA' },
  },
  'one-dark-slate': {
    id: 'one-dark-slate', name: 'One Dark Slate', group: 'Dark', overall: 78,
    bg: '#282C34', fg: '#D2D6DE', textDim: '#97A0AE', hoverBg: '#353B45',
    sentBg: '#4B5363', sentText: '#F2F4F8', wordBg: '#C8B998', wordText: '#282C34',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#2A2C31', chromeFg: '#C8CCD0', chromeLine: '#505256', chromeHover: '#2E3137', panelBg: '#24262B', titlebarBg: '#2C2F34', btnBg: '#272A2F', accent: '#6F86A3', accentHover: '#7D93AE', textDim: '#9DA0A5', textMuted: '#8C8F93', scrollbar: '#4E5055', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#26292E', modalBorder: '#68696D', hlItemBg: '#24262B', hlSelBg: '#4C596B', hlSelBorder: '#8DA0B8' },
  },
  'night-blue-harbor': {
    id: 'night-blue-harbor', name: 'Night Blue Harbor', group: 'Dark', overall: 76,
    bg: '#15202B', fg: '#BFC9D5', textDim: '#8798AA', hoverBg: '#203040',
    sentBg: '#31485D', sentText: '#EAF0F6', wordBg: '#B2A37D', wordText: '#15202B',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#1B1F24', chromeFg: '#B9BDC2', chromeLine: '#44474B', chromeHover: '#20252A', panelBg: '#15181B', titlebarBg: '#1F252A', btnBg: '#191D21', accent: '#6487A8', accentHover: '#7394B3', textDim: '#8F9396', textMuted: '#808386', scrollbar: '#3F4346', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#181C1F', modalBorder: '#5E6062', hlItemBg: '#16181C', hlSelBg: '#3F5366', hlSelBorder: '#84A1BC' },
  },
  'kindle-sepia': {
    id: 'kindle-sepia', name: 'Kindle Sepia', group: 'In-between', overall: 90.5,
    bg: '#f5ecd7', fg: '#433422', textDim: '#7e6d53', hoverBg: '#ede1c5',
    sentBg: '#dfd1b2', sentText: '#22170d', wordBg: '#433422', wordText: '#f5ecd7',
    catNote: '#1e5fa8', catRule: '#9a4e10', catKey: '#1a6b3a', catNever: '#8b1f1f',
    chrome: { chromeBg: '#E0DED8', chromeFg: '#373A3F', chromeLine: '#A8A6A2', chromeHover: '#D9D7D1', panelBg: '#E2E0DB', titlebarBg: '#DAD8D2', btnBg: '#DFDDD8', accent: '#7C8772', accentHover: '#6F7A66', textDim: '#595B5E', textMuted: '#626466', scrollbar: '#BCBBB8', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#E1DFD9', modalBorder: '#8E8D8A', hlItemBg: '#E9E7E3', hlSelBg: '#B2B6AA', hlSelBorder: '#66705E' },
  },
  'sepia-reader': {
    id: 'sepia-reader', name: 'Sepia Reader', group: 'In-between', overall: 89,
    bg: '#F4ECD8', fg: '#4A3B2F', textDim: '#7B6857', hoverBg: '#EDE1C7',
    sentBg: '#DDD1B8', sentText: '#43362B', wordBg: '#74635A', wordText: '#FFFDF8',
    catNote: '#2F6FB3', catRule: '#B06F12', catKey: '#2E8B73', catNever: '#C2543F',
    chrome: { chromeBg: '#E0DED8', chromeFg: '#373A3F', chromeLine: '#A8A6A2', chromeHover: '#D9D7D1', panelBg: '#E2E0DB', titlebarBg: '#DAD8D2', btnBg: '#DFDDD8', accent: '#788372', accentHover: '#6B7666', textDim: '#595B5E', textMuted: '#626466', scrollbar: '#BCBBB8', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#E1DFD9', modalBorder: '#8E8D8A', hlItemBg: '#E9E7E3', hlSelBg: '#B0B4AA', hlSelBorder: '#626D5E' },
  },
  'e-paper-slate-gray': {
    id: 'e-paper-slate-gray', name: 'E-Paper Slate Gray', group: 'In-between', overall: 88.5,
    bg: '#e2e5e8', fg: '#26292e', textDim: '#5b6068', hoverBg: '#d4d8dd',
    sentBg: '#c5cbd2', sentText: '#0f1114', wordBg: '#26292e', wordText: '#e2e5e8',
    catNote: '#56b4e9', catRule: '#e69f00', catKey: '#f0e442', catNever: '#d55e00',
    chrome: { chromeBg: '#D8DBDE', chromeFg: '#34383E', chromeLine: '#A2A4A6', chromeHover: '#D1D4D7', panelBg: '#DBDDE0', titlebarBg: '#D2D5D8', btnBg: '#D8DADD', accent: '#74879A', accentHover: '#667A8F', textDim: '#55595E', textMuted: '#5E6166', scrollbar: '#B5B8BB', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#D9DCDF', modalBorder: '#8A8B8D', hlItemBg: '#E4E5E7', hlSelBg: '#ABB5BF', hlSelBorder: '#5E7084' },
  },
  'solarized-warm-paper': {
    id: 'solarized-warm-paper', name: 'Solarized Warm Paper', group: 'In-between', overall: 88,
    bg: '#fdf6e3', fg: '#46575c', textDim: '#778688', hoverBg: '#eee8d5',
    sentBg: '#dfd5be', sentText: '#073642', wordBg: '#23867e', wordText: '#000c10',
    catNote: '#2076b2', catRule: '#c44815', catKey: '#687800', catNever: '#d5302e',
    chrome: { chromeBg: '#E8E7E4', chromeFg: '#3C3F44', chromeLine: '#AEADAB', chromeHover: '#E1DFDB', panelBg: '#EAE9E6', titlebarBg: '#E0DEDB', btnBg: '#E7E5E2', accent: '#6F8B90', accentHover: '#637E82', textDim: '#5F6164', textMuted: '#686A6C', scrollbar: '#C3C2C1', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#E8E7E4', modalBorder: '#969593', hlItemBg: '#EFEFEC', hlSelBg: '#B0BDBE', hlSelBorder: '#5B7478' },
  },
  'twilight-taupe': {
    id: 'twilight-taupe', name: 'Twilight Taupe', group: 'In-between', overall: 86,
    bg: '#211D1A', fg: '#CCC2B5', textDim: '#988A7C', hoverBg: '#2B2622',
    sentBg: '#4A413A', sentText: '#F3EEE5', wordBg: '#AC9B82', wordText: '#211D1A',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#1F1D1B', chromeFg: '#B8BBBD', chromeLine: '#474644', chromeHover: '#252320', panelBg: '#171614', titlebarBg: '#25221F', btnBg: '#1D1B19', accent: '#8B7E6A', accentHover: '#988B76', textDim: '#909294', textMuted: '#808284', scrollbar: '#404040', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#1B1917', modalBorder: '#5F5E5D', hlItemBg: '#171615', hlSelBg: '#554D42', hlSelBorder: '#A49986' },
  },
  'gruvbox-warm': {
    id: 'gruvbox-warm', name: 'Gruvbox Warm', group: 'In-between', overall: 84,
    bg: '#282828', fg: '#D8CCAE', textDim: '#A89984', hoverBg: '#3C3836',
    sentBg: '#504945', sentText: '#F3E9D2', wordBg: '#B7A57F', wordText: '#282828',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#272727', chromeFg: '#C2C5C8', chromeLine: '#4E4E4E', chromeHover: '#2E2E2E', panelBg: '#212121', titlebarBg: '#2D2D2D', btnBg: '#262626', accent: '#9A865E', accentHover: '#A7936B', textDim: '#999B9E', textMuted: '#888A8C', scrollbar: '#4B4C4D', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#242424', modalBorder: '#666666', hlItemBg: '#222222', hlSelBg: '#625741', hlSelBorder: '#B2A07D' },
  },
  'night-blue': {
    id: 'night-blue', name: 'Night Blue', group: 'In-between', overall: 84,
    bg: '#0c1524', fg: '#cad5e3', textDim: '#647791', hoverBg: '#16253b',
    sentBg: '#1d3251', sentText: '#ffffff', wordBg: '#f59e0b', wordText: '#0c1524',
    catNote: '#3b82f6', catRule: '#ea580c', catKey: '#10b981', catNever: '#ef4444',
    chrome: { chromeBg: '#14171B', chromeFg: '#B2B5B9', chromeLine: '#414346', chromeHover: '#151A1E', panelBg: '#090A0C', titlebarBg: '#181C21', btnBg: '#0F1215', accent: '#658AB0', accentHover: '#7497BA', textDim: '#878A8D', textMuted: '#787B7E', scrollbar: '#343638', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#0D0F12', modalBorder: '#58585A', hlItemBg: '#0A0C0E', hlSelBg: '#3A4F64', hlSelBorder: '#85A3C2' },
  },
  'solarized-light-reader': {
    id: 'solarized-light-reader', name: 'Solarized Light Reader', group: 'In-between', overall: 82,
    bg: '#FDF6E3', fg: '#44575D', textDim: '#7B8B8C', hoverBg: '#F5EFD9',
    sentBg: '#EEE8D5', sentText: '#4F666D', wordBg: '#5F747B', wordText: '#FFFFFF',
    catNote: '#2F6FB3', catRule: '#B06F12', catKey: '#2E8B73', catNever: '#C2543F',
    chrome: { chromeBg: '#E8E7E4', chromeFg: '#3C3F44', chromeLine: '#AEADAB', chromeHover: '#E1DFDB', panelBg: '#EAE9E6', titlebarBg: '#E0DEDB', btnBg: '#E7E5E2', accent: '#6A8A92', accentHover: '#5E7D84', textDim: '#5F6164', textMuted: '#686A6C', scrollbar: '#C3C2C1', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#E8E7E4', modalBorder: '#969593', hlItemBg: '#EFEFEC', hlSelBg: '#AEBCBF', hlSelBorder: '#567379' },
  },
  'solarized-dark-reader': {
    id: 'solarized-dark-reader', name: 'Solarized Dark Reader', group: 'In-between', overall: 80,
    bg: '#002B36', fg: '#ADB9B9', textDim: '#7F9195', hoverBg: '#073642',
    sentBg: '#17424D', sentText: '#E6E8DA', wordBg: '#BBAA84', wordText: '#002B36',
    catNote: '#6FA8DC', catRule: '#D89A4E', catKey: '#63B08B', catNever: '#D26B5B',
    chrome: { chromeBg: '#171D1E', chromeFg: '#B4B9BC', chromeLine: '#414646', chromeHover: '#1F2628', panelBg: '#151B1C', titlebarBg: '#1B2324', btnBg: '#181E1F', accent: '#5D8E99', accentHover: '#699BA6', textDim: '#919599', textMuted: '#808487', scrollbar: '#3E4446', scrim: 'rgba(5, 7, 10, 0.64)', modalBg: '#171D1E', modalBorder: '#5E6262', hlItemBg: '#151A1B', hlSelBg: '#3B585F', hlSelBorder: '#7BA7B1' },
  },
  'quiet-paper': {
    id: 'quiet-paper', name: 'Quiet Paper', group: 'Light', overall: 88,
    bg: '#F4F1E8', fg: '#4A433B', textDim: '#766B60', hoverBg: '#ECE6D8',
    sentBg: '#E3DDD0', sentText: '#4A433B', wordBg: '#6B7285', wordText: '#FFFFFF',
    catNote: '#2F6FB3', catRule: '#B06F12', catKey: '#2E8B73', catNever: '#C2543F',
    chrome: { chromeBg: '#E7E5E1', chromeFg: '#3C3F44', chromeLine: '#ADACA9', chromeHover: '#E0DDD9', panelBg: '#E9E7E4', titlebarBg: '#DFDCD8', btnBg: '#E6E3E0', accent: '#7D8777', accentHover: '#707A6B', textDim: '#5D5F62', textMuted: '#66686A', scrollbar: '#C1C0BF', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#E7E5E2', modalBorder: '#939290', hlItemBg: '#EFEDEB', hlSelBg: '#B6BAB1', hlSelBorder: '#677062' },
  },
  'github-paper': {
    id: 'github-paper', name: 'GitHub Paper', group: 'Light', overall: 85,
    bg: '#F6F8FA', fg: '#404A55', textDim: '#66707B', hoverBg: '#EEF2F8',
    sentBg: '#E2E8F4', sentText: '#404A55', wordBg: '#5F6B85', wordText: '#FFFFFF',
    catNote: '#2F6FB3', catRule: '#B06F12', catKey: '#2E8B73', catNever: '#C2543F',
    chrome: { chromeBg: '#ECEEEF', chromeFg: '#404449', chromeLine: '#B1B2B3', chromeHover: '#E4E5E8', panelBg: '#EFF0F2', titlebarBg: '#E3E5E7', btnBg: '#EBECEE', accent: '#74869A', accentHover: '#66798F', textDim: '#62656A', textMuted: '#6B6E72', scrollbar: '#C7C9CC', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#EDEEF0', modalBorder: '#999A9B', hlItemBg: '#F4F4F6', hlSelBg: '#B5BEC9', hlSelBorder: '#5E6F84' },
  },
  'gruvbox-warm-light': {
    id: 'gruvbox-warm-light', name: 'Gruvbox Warm Light', group: 'Light', overall: 83,
    bg: '#fbf1c7', fg: '#282828', textDim: '#7c6f64', hoverBg: '#f2e5bc',
    sentBg: '#ebdcb2', sentText: '#282828', wordBg: '#076678', wordText: '#fbf1c7',
    catNote: '#076678', catRule: '#af3a03', catKey: '#75700e', catNever: '#9d0006',
    chrome: { chromeBg: '#DAD9D2', chromeFg: '#33363B', chromeLine: '#A4A39E', chromeHover: '#D4D3CB', panelBg: '#DDDCD5', titlebarBg: '#D5D4CC', btnBg: '#DAD9D2', accent: '#8A865A', accentHover: '#7C784F', textDim: '#57595B', textMuted: '#5E6062', scrollbar: '#B7B7B3', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#DCDBD3', modalBorder: '#8B8B86', hlItemBg: '#E5E4DF', hlSelBg: '#B6B49C', hlSelBorder: '#726E49' },
  },
  'daylight-soft': {
    id: 'daylight-soft', name: 'Daylight Soft', group: 'Light', overall: 83,
    bg: '#FAFBFC', fg: '#404A55', textDim: '#69737E', hoverBg: '#F0F3F6',
    sentBg: '#E7EAF0', sentText: '#404A55', wordBg: '#6D7486', wordText: '#FFFFFF',
    catNote: '#2F6FB3', catRule: '#B06F12', catKey: '#2E8B73', catNever: '#C2543F',
    chrome: { chromeBg: '#EEF1F3', chromeFg: '#41444A', chromeLine: '#B2B5B6', chromeHover: '#E6E8ED', panelBg: '#F1F3F5', titlebarBg: '#E5E8EB', btnBg: '#EDEFF2', accent: '#8697A8', accentHover: '#768A9E', textDim: '#64686C', textMuted: '#6B6F73', scrollbar: '#C9CBCE', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#EFF1F3', modalBorder: '#9A9C9D', hlItemBg: '#F5F7F8', hlSelBg: '#BFC8D1', hlSelBorder: '#6D7F91' },
  },
  'notion-cozy-light': {
    id: 'notion-cozy-light', name: 'Notion Cozy Light', group: 'Light', overall: 80.5,
    bg: '#f9f9fb', fg: '#1f2022', textDim: '#656a73', hoverBg: '#f1f1f4',
    sentBg: '#e2e4e9', sentText: '#0f1011', wordBg: '#0056b3', wordText: '#ffffff',
    catNote: '#0056b3', catRule: '#c2410c', catKey: '#15803d', catNever: '#b91c1c',
    chrome: { chromeBg: '#EEEEF2', chromeFg: '#41444A', chromeLine: '#B2B2B6', chromeHover: '#E7E7EC', panelBg: '#F1F1F4', titlebarBg: '#E9E9EF', btnBg: '#EEEEF2', accent: '#7A8794', accentHover: '#6C7A88', textDim: '#62656A', textMuted: '#6B6E73', scrollbar: '#CACACE', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#F0F0F3', modalBorder: '#9A9A9C', hlItemBg: '#F5F5F8', hlSelBg: '#B9BFC7', hlSelBorder: '#63707D' },
  },
  'nord-snow': {
    id: 'nord-snow', name: 'Nord Snow', group: 'Light', overall: 77,
    bg: '#eceff4', fg: '#2e3440', textDim: '#5e80ab', hoverBg: '#e5e9f0',
    sentBg: '#d8dee9', sentText: '#2e3440', wordBg: '#2e3440', wordText: '#eceff4',
    catNote: '#3b4252', catRule: '#946050', catKey: '#617153', catNever: '#a6545c',
    chrome: { chromeBg: '#E4E5E8', chromeFg: '#3B3F44', chromeLine: '#ABACAE', chromeHover: '#DBDCE1', panelBg: '#E6E7EA', titlebarBg: '#DBDCE0', btnBg: '#E2E3E7', accent: '#7D96B2', accentHover: '#6B89AA', textDim: '#5C5F64', textMuted: '#65686D', scrollbar: '#BFC0C4', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#E4E5E8', modalBorder: '#919293', hlItemBg: '#ECEDEF', hlSelBg: '#B5C1D0', hlSelBorder: '#627E9C' },
  },
  'github-light-touch': {
    id: 'github-light-touch', name: 'GitHub Light Touch', group: 'Light', overall: 73.5,
    bg: '#f6f8fa', fg: '#24292f', textDim: '#57606a', hoverBg: '#eaeef2',
    sentBg: '#ddf4ff', sentText: '#0969da', wordBg: '#0969da', wordText: '#ffffff',
    catNote: '#648fff', catRule: '#fe6100', catKey: '#ffb000', catNever: '#dc267f',
    chrome: { chromeBg: '#ECEEEF', chromeFg: '#404449', chromeLine: '#B1B2B3', chromeHover: '#E4E5E8', panelBg: '#EFF0F2', titlebarBg: '#E3E5E7', btnBg: '#EBECEE', accent: '#74889B', accentHover: '#667B90', textDim: '#62656A', textMuted: '#6B6E72', scrollbar: '#C7C9CC', scrim: 'rgba(22, 24, 28, 0.28)', modalBg: '#EDEEF0', modalBorder: '#999A9B', hlItemBg: '#F4F4F6', hlSelBg: '#B5BFC9', hlSelBorder: '#5E7184' },
  },
};

const THEME_GROUP_ORDER = ['Dark', 'In-between', 'Light'];

