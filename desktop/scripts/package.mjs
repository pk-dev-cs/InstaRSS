import packager from "@electron/packager";

const paths=await packager({
  dir:process.cwd(),name:"InstaRSS",platform:"win32",arch:"x64",out:"out",overwrite:true,
  icon:"assets/icon.ico",prune:true,asar:false,
  ignore:[/^\/out($|\/)/,/^\/Releases($|\/)/,/^\/src($|\/)/,/^\/scripts($|\/)/,/^\/tests($|\/)/,/^\/\.env/,/^\/tsconfig/,/^\/vite\.config/],
});
console.log(paths.join("\n"));
