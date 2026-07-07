const {execSync}=require("child_process");
const os=require("os");

if(os.platform()!=="win32"){
 console.log("[wps] skipped");
 process.exit(0);
}

execSync(
"powershell -NoProfile -ExecutionPolicy Bypass -File apps/wps/build.ps1 -OutputDir apps/wps/dist",
{
stdio:"inherit"
});