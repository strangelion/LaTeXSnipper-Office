const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const jsaddons = path.join(process.env.APPDATA, 'kingsoft', 'wps', 'jsaddons');
const publishXml = path.join(jsaddons, 'publish.xml');
const authJson = path.join(jsaddons, 'authaddin.json');

console.log('[START] Launching wpsjs debug...');
const wpsjs = spawn('npx', ['wpsjs', 'debug'], { stdio: 'inherit', shell: true });

setTimeout(() => {
  try {
    if (fs.existsSync(publishXml)) {
      let xml = fs.readFileSync(publishXml, 'utf-8');
      if (xml.indexOf('type="wpp"') === -1) {
        xml = xml.replace(
          /(<\/jsplugins>)/,
          '  <jspluginonline name="latexsnipper-wps" type="wpp" url="http://127.0.0.1:3889/" debug="" enable="enable_dev" install="null"/>\n$1'
        );
        fs.writeFileSync(publishXml, xml, 'utf-8');
        console.log('[START] Added wpp entry to publish.xml');
      }
    }

    if (fs.existsSync(authJson)) {
      let json = JSON.parse(fs.readFileSync(authJson, 'utf-8'));
      if (!json.wpp) {
        json.wpp = JSON.parse(JSON.stringify(json.wps));
        fs.writeFileSync(authJson, JSON.stringify(json, null, 4), 'utf-8');
        console.log('[START] Added wpp entry to authaddin.json');
      } else if (json.wpp && json.wpp[Object.keys(json.wpp)[0]]) {
        let key = Object.keys(json.wpp).find(k => k !== 'namelist');
        if (key && json.wpp[key].isload === false) {
          json.wpp[key].isload = true;
          fs.writeFileSync(authJson, JSON.stringify(json, null, 4), 'utf-8');
          console.log('[START] Fixed wpp isload to true');
        }
      }
    }
  } catch (e) {
    console.error('[START] Patch error:', e.message);
  }
}, 3000);

wpsjs.on('close', (code) => {
  process.exit(code);
});
