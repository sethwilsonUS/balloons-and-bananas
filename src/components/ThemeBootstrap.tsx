// Run in the document head before paint, so a saved preference never flashes
// the opposite system theme while React hydrates. This reads only a theme name.
const themeScript = `(function(){try{var t=localStorage.getItem('balloons-and-bananas:theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'system'}catch(e){}})();`;

export default function ThemeBootstrap() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
