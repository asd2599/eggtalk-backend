const petCore = require("./petModules/petCore");
const petBehavior = require("./petModules/petBehavior");
const petSocial = require("./petModules/petSocial");
const petChild = require("./petModules/petChild");

module.exports = {
  ...petCore,
  ...petBehavior,
  ...petSocial,
  ...petChild,
};
