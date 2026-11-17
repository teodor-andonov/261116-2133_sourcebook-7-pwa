const configured = process.env.SOURCEBOOK_BASE ?? "/";
export const deploymentBase =
  "/" + configured.split("/").filter(Boolean).map(encodeURIComponent).join("/");
export const appBase = deploymentBase === "/" ? "/" : deploymentBase + "/";
