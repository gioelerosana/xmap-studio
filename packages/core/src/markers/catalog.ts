export interface MarkerInfo {
  id: string;
  name: string;
}

export interface MarkerGroup {
  id: string;
  label: string;
  markers: MarkerInfo[];
}

export const GROUPS: MarkerGroup[] = [
  {
    id: 'priorityMarkers',
    label: 'Priorità',
    markers: [
      { id: 'priority-1', name: 'Priority 1' },
      { id: 'priority-2', name: 'Priority 2' },
      { id: 'priority-3', name: 'Priority 3' },
      { id: 'priority-4', name: 'Priority 4' },
      { id: 'priority-5', name: 'Priority 5' },
      { id: 'priority-6', name: 'Priority 6' },
      { id: 'priority-7', name: 'Priority 7' },
      { id: 'priority-8', name: 'Priority 8' },
      { id: 'priority-9', name: 'Priority 9' },
    ],
  },
  {
    id: 'taskMarkers',
    label: 'Avanzamento',
    markers: [
      { id: 'task-3oct', name: '3/8 Done' },
      { id: 'task-3quar', name: '3/4 Done' },
      { id: 'task-5oct', name: '5/8 Done' },
      { id: 'task-7oct', name: '7/8 Done' },
      { id: 'task-done', name: 'Task Done' },
      { id: 'task-half', name: '1/2 Done' },
      { id: 'task-oct', name: '1/8 Done' },
      { id: 'task-quarter', name: '1/4 Done' },
      { id: 'task-start', name: 'Task Starting' },
    ],
  },
  {
    id: 'flagMarkers',
    label: 'Bandierine',
    markers: [
      { id: 'flag-blue', name: 'Blue Flag' },
      { id: 'flag-dark-blue', name: 'Dark Blue Flag' },
      { id: 'flag-dark-gray', name: 'Dark Gray Flag' },
      { id: 'flag-dark-green', name: 'Dark Green Flag' },
      { id: 'flag-gray', name: 'Gray Flag' },
      { id: 'flag-green', name: 'Green Flag' },
      { id: 'flag-orange', name: 'Orange Flag' },
      { id: 'flag-purple', name: 'Purple Flag' },
      { id: 'flag-red', name: 'Red Flag' },
      { id: 'flag-yellow', name: 'Yellow Flag' },
    ],
  },
  {
    id: 'starMarkers',
    label: 'Stelle',
    markers: [
      { id: 'star-blue', name: 'Blue Star' },
      { id: 'star-dark-blue', name: 'Dark Blue Star' },
      { id: 'star-dark-gray', name: 'Dark Gray Star' },
      { id: 'star-dark-green', name: 'Dark Green Star' },
      { id: 'star-gray', name: 'Gray Star' },
      { id: 'star-green', name: 'Green Star' },
      { id: 'star-orange', name: 'Orange Star' },
      { id: 'star-purple', name: 'Purple Star' },
      { id: 'star-red', name: 'Red Star' },
      { id: 'star-yellow', name: 'Yellow Star' },
    ],
  },
  {
    id: 'smileyMarkers',
    label: 'Faccine',
    markers: [
      { id: 'smiley-adore', name: 'Adore' },
      { id: 'smiley-angry', name: 'Angry' },
      { id: 'smiley-boring', name: 'Boring' },
      { id: 'smiley-cry-laugh', name: 'Cry Laugh' },
      { id: 'smiley-cry', name: 'Cry' },
      { id: 'smiley-devil', name: 'Devil' },
      { id: 'smiley-embarrass', name: 'Embarrass' },
      { id: 'smiley-laugh', name: 'Laugh' },
      { id: 'smiley-love', name: 'Love' },
      { id: 'smiley-sad', name: 'Sad' },
      { id: 'smiley-smile', name: 'Smile' },
      { id: 'smiley-surprise', name: 'Surprise' },
      { id: 'smiley-think', name: 'Think' },
      { id: 'smiley-upset', name: 'Upset' },
    ],
  },
  {
    id: 'peopleMarkers',
    label: 'Persone',
    markers: [
      { id: 'people-blue', name: 'Blue Avatar' },
      { id: 'people-dark-blue', name: 'Dark Blue Avatar' },
      { id: 'people-dark-gray', name: 'Dark Gray Avatar' },
      { id: 'people-dark-green', name: 'Dark Green Avatar' },
      { id: 'people-gray', name: 'Gray Avatar' },
      { id: 'people-green', name: 'Green Avatar' },
      { id: 'people-orange', name: 'Orange Avatar' },
      { id: 'people-purple', name: 'Purple Avatar' },
      { id: 'people-red', name: 'Red Avatar' },
      { id: 'people-yellow', name: 'Yellow Avatar' },
    ],
  },
  {
    id: 'arrowMarkers',
    label: 'Frecce',
    markers: [
      { id: 'arrow-down-left', name: 'Down and Left' },
      { id: 'arrow-down-right', name: 'Down and Right' },
      { id: 'arrow-down', name: 'Down' },
      { id: 'arrow-left-right', name: 'Left and Right' },
      { id: 'arrow-left', name: 'Left' },
      { id: 'arrow-refresh', name: 'Refresh' },
      { id: 'arrow-right', name: 'Right' },
      { id: 'arrow-up-down', name: 'Up and Down' },
      { id: 'arrow-up-left', name: 'Up and Left' },
      { id: 'arrow-up-right', name: 'Up and Right' },
      { id: 'arrow-up', name: 'Up' },
    ],
  },
  {
    id: 'symbolMarkers',
    label: 'Simboli',
    markers: [
      { id: 'c_simbol-exclam', name: 'symbolExclam' },
      { id: 'c_simbol-info', name: 'symbolInfo' },
      { id: 'c_simbol-minus', name: 'Minus' },
      { id: 'c_simbol-pause', name: 'Pause' },
      { id: 'c_simbol-plus', name: 'Plus' },
      { id: 'c_simbol-question', name: 'Question' },
      { id: 'c_simbol-right', name: 'Check' },
      { id: 'c_simbol-wrong', name: 'Wrong' },
      { id: 'c_symbol_bar_chart', name: 'Bar Chart' },
      { id: 'c_symbol_contact', name: 'Contact' },
      { id: 'c_symbol_dislike', name: 'Dislike' },
      { id: 'c_symbol_drink', name: 'symbolDrink' },
      { id: 'c_symbol_exercise', name: 'Exercise' },
      { id: 'c_symbol_flight', name: 'Flight' },
      { id: 'c_symbol_heart', name: 'Heart' },
      { id: 'c_symbol_hourglass', name: 'Hourglass' },
      { id: 'c_symbol_like', name: 'Like' },
      { id: 'c_symbol_line_graph', name: 'symbolLineGraph' },
      { id: 'c_symbol_lock', name: 'Lock' },
      { id: 'c_symbol_medals', name: 'symbolMedals' },
      { id: 'c_symbol_money', name: 'Money' },
      { id: 'c_symbol_music', name: 'Music' },
      { id: 'c_symbol_pen', name: 'Pen' },
      { id: 'c_symbol_pie_chart', name: 'Pie Chart' },
      { id: 'c_symbol_shopping_cart', name: 'Shopping Cart' },
      { id: 'c_symbol_telephone', name: 'Telephone' },
      { id: 'c_symbol_thermometer', name: 'symbolThermometer' },
      { id: 'c_symbol_trophy', name: 'Trophy' },
      { id: 'symbol-100', name: '100' },
      { id: 'symbol-attention', name: 'Attention' },
      { id: 'symbol-diamond', name: 'Diamond' },
      { id: 'symbol-entertainment', name: 'Entertainment' },
      { id: 'symbol-exclam', name: 'symbolExclam' },
      { id: 'symbol-idea', name: 'Idea' },
      { id: 'symbol-info', name: 'symbolInfo' },
      { id: 'symbol-lightning', name: 'Lightning' },
      { id: 'symbol-minus', name: 'Minus' },
      { id: 'symbol-pause', name: 'Pause' },
      { id: 'symbol-pin', name: 'Pin' },
      { id: 'symbol-plus', name: 'Plus' },
      { id: 'symbol-question', name: 'Question' },
      { id: 'symbol-right', name: 'Check' },
      { id: 'symbol-run', name: 'Run' },
      { id: 'symbol-unlock', name: 'Unlock' },
      { id: 'symbol-wrong', name: 'Wrong' },
    ],
  },
  {
    id: 'academicMarkers',
    label: 'Studio',
    markers: [
      { id: 'c_symbol_apostrophe', name: 'Apostrophe' },
      { id: 'c_symbol_quote', name: 'Quote' },
      { id: 'symbol-about', name: 'About' },
      { id: 'symbol-code', name: 'Code' },
      { id: 'symbol-divide', name: 'Divide' },
      { id: 'symbol-equality', name: 'Equality' },
      { id: 'symbol-not-equality', name: 'Not Equality' },
    ],
  },
  {
    id: 'socialMarkers',
    label: 'Social',
    markers: [
      { id: 'c_symbol_broken_heart', name: 'Broken Heart' },
      { id: 'symbol-comment', name: 'Comment' },
      { id: 'symbol-no-entry', name: 'No Entry' },
      { id: 'symbol-notice', name: 'Notice' },
      { id: 'symbol-rss', name: 'RSS' },
      { id: 'symbol-share', name: 'Share' },
      { id: 'symbol_forward', name: 'Forward' },
    ],
  },
  {
    id: 'otherMarkers',
    label: 'Altro',
    markers: [
      { id: 'other-exclam', name: 'Exclamation Mark' },
      { id: 'other-no', name: 'No' },
      { id: 'other-question', name: 'Question' },
      { id: 'other-yes', name: 'Yes' },
      { id: 'symbol-image', name: 'symbolImage' },
    ],
  },
  {
    id: 'monthMarkers',
    label: 'Mesi',
    markers: [
      { id: 'month-apr', name: 'April' },
      { id: 'month-aug', name: 'August' },
      { id: 'month-dec', name: 'December' },
      { id: 'month-feb', name: 'February' },
      { id: 'month-jan', name: 'January' },
      { id: 'month-jul', name: 'July' },
      { id: 'month-jun', name: 'June' },
      { id: 'month-mar', name: 'March' },
      { id: 'month-may', name: 'May' },
      { id: 'month-nov', name: 'November' },
      { id: 'month-oct', name: 'October' },
      { id: 'month-sep', name: 'September' },
    ],
  },
  {
    id: 'weekMarkers',
    label: 'Giorni',
    markers: [
      { id: 'week-fri', name: 'Friday' },
      { id: 'week-mon', name: 'Monday' },
      { id: 'week-sat', name: 'Saturday' },
      { id: 'week-sun', name: 'Sunday' },
      { id: 'week-thu', name: 'Thursday' },
      { id: 'week-tue', name: 'Tuesday' },
      { id: 'week-wed', name: 'Wednesday' },
    ],
  },
  {
    id: 'celebrationMarkers',
    label: 'Celebrazioni',
    markers: [
      { id: 'celebration-100', name: '100' },
      { id: 'celebration-birthday', name: 'Birthday' },
      { id: 'celebration-boom', name: 'Boom' },
      { id: 'celebration-cheers', name: 'Cheers' },
      { id: 'celebration-clap', name: 'Clap' },
      { id: 'celebration-five', name: 'Give Me Five' },
      { id: 'celebration-king', name: 'Crown' },
      { id: 'celebration-kiss', name: 'Kiss' },
      { id: 'celebration-ribbon', name: 'Ribbon' },
    ],
  },
  {
    id: 'tagMarkers',
    label: 'Etichette colorate',
    markers: [
      { id: 'tag-blue', name: 'Blue Tag' },
      { id: 'tag-dark-blue', name: 'Dark Blue Tag' },
      { id: 'tag-dark-purple', name: 'Dark Purple Tag' },
      { id: 'tag-green', name: 'Green Tag' },
      { id: 'tag-grey', name: 'Grey Tag' },
      { id: 'tag-orange', name: 'Orange Tag' },
      { id: 'tag-red', name: 'Red Tag' },
      { id: 'tag-yellow', name: 'Yellow Tag' },
    ],
  },
];

const markerMap = new Map<string, string>();
for (const g of GROUPS) {
  for (const m of g.markers) {
    markerMap.set(m.id, m.name);
  }
}

export function markerNameOf(id: string): string | undefined {
  return markerMap.get(id);
}

export function isMarkerKnown(id: string): boolean {
  return markerMap.has(id);
}

export function markerDisplayName(id: string): string {
  return markerMap.get(id) || id;
}
