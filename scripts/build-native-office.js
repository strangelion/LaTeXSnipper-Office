const { execSync } = require("child_process");
const os = require("os");

if (os.platform() !== "win32") {
    console.log(
        "[native-office] skipped: VSTO only supports Windows"
    );
    process.exit(0);
}

execSync(
    "powershell -NoProfile -ExecutionPolicy Bypass -File apps/native-office/Installer/build.ps1 -OutputDir apps/native-office/Installer/output",
    {
        stdio: "inherit"
    }
);