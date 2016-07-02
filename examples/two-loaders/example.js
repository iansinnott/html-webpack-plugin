require('./main.css');
var h1 = document.createElement('h1');
let innerHTML = '';
if (HTML_WEBPACK_PLUGIN) {
  innerHTML = 'there was a magic global at play'
} else {
  innerHTML = 'not webpacked';
}
h1.innerHTML = innerHTML;
document.body.appendChild(h1);
