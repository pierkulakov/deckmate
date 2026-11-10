// Builds the notices that must sit next to Deckmate.exe in both the NSIS install and the portable zip.
// prepare-sidecar.mjs downloads and authenticates the pinned Node.js LICENSE before calling this script.
// Cargo's locked, Windows-filtered normal dependency graph supplies every Rust crate used by the release binary.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TARGET = 'x86_64-pc-windows-msvc';
const LICENSE_FILE = /^(?:license|copying|notice|copyright)(?:[._-]|$)/iu;
// The DLL bundled by webview2-com-sys 0.39.1 identifies SDK 1.0.3800.47. Its matching
// Microsoft.Web.WebView2 NuGet package carries this BSD-3-Clause license for the static loader.
const WEBVIEW2 = {
  crate: 'webview2-com-sys',
  crateVersion: '0.39.1',
  sdkVersion: '1.0.3800.47',
  source: 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3800.47/microsoft.web.webview2.1.0.3800.47.nupkg (LICENSE.txt)',
  text: `Copyright (C) Microsoft Corporation. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * The name of Microsoft Corporation, or the names of its contributors 
may not be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
};

const MIT = `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD_3_CLAUSE = `BSD 3-Clause License

Copyright (c) <year> <copyright holders>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const MPL_2_0 = `Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.`;

// Only identifiers needed by crates in the locked graph without a shipped license file belong here.
// An update that introduces another identifier must fail until its full standard text is added.
const SPDX_TEXTS = new Map([
  ['BSD-3-Clause', BSD_3_CLAUSE],
  ['MIT', MIT],
  ['MPL-2.0', MPL_2_0],
]);

export function fallbackLicenseTexts(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('A crate without license files must declare an SPDX license expression.');
  }
  const identifiers = expression.match(/[A-Za-z0-9.-]+/gu)
    ?.filter(part => !['AND', 'OR', 'WITH'].includes(part.toUpperCase())) ?? [];
  if (identifiers.length === 0) throw new Error(`Cannot parse SPDX license expression: ${expression}`);
  return identifiers.map(identifier => {
    const text = SPDX_TEXTS.get(identifier);
    if (text === undefined) {
      throw new Error(`No standard license text is known for SPDX identifier ${identifier} (${expression}).`);
    }
    return { license: identifier, text, source: `SPDX ${identifier} standard text (crate has no license file)` };
  });
}

export function noticesForCrate(crate, licenseFiles) {
  if (typeof crate.license !== 'string' || crate.license.trim() === '') {
    throw new Error(`${crate.name} ${crate.version} has no SPDX license expression.`);
  }
  if (licenseFiles.length > 0) {
    return licenseFiles.map(file => ({
      crate: { name: crate.name, version: crate.version, license: crate.license },
      source: `${crate.name} ${crate.version}: ${file.name}`,
      text: file.text,
    }));
  }
  return fallbackLicenseTexts(crate.license).map(fallback => ({
    crate: { name: crate.name, version: crate.version, license: crate.license },
    source: `${crate.name} ${crate.version}: ${fallback.source}`,
    text: fallback.text,
  }));
}

export function groupIdenticalNotices(notices) {
  const groups = new Map();
  for (const notice of notices) {
    const text = notice.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
    if (text === '') throw new Error(`Empty license text: ${notice.source}`);
    const key = createHash('sha256').update(text).digest('hex');
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, text, crates: new Map(), sources: new Set() };
      groups.set(key, group);
    }
    const crateKey = `${notice.crate.name}@${notice.crate.version}`;
    if (!group.crates.has(crateKey)) group.crates.set(crateKey, notice.crate);
    group.sources.add(notice.source);
  }
  return [...groups.values()].sort((left, right) => {
    const a = [...left.crates.values()][0];
    const b = [...right.crates.values()][0];
    return a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || left.key.localeCompare(right.key);
  });
}

export function collectReleaseCrates(metadata) {
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const root = packages.get(metadata.resolve.root);
  if (root?.name !== 'deckmate-desktop' || !root.targets.some(target => target.kind.includes('bin') && target.name === 'Deckmate')) {
    throw new Error('Cargo metadata root is not the deckmate-desktop package with the Deckmate binary.');
  }
  const reached = new Set([root.id]);
  const queue = [root.id];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const dependency of nodes.get(id)?.deps ?? []) {
      // Release binary dependencies only: build scripts and dev-dependencies are not linked into Deckmate.exe.
      if (!dependency.dep_kinds.some(kind => kind.kind === null) || reached.has(dependency.pkg)) continue;
      reached.add(dependency.pkg);
      queue.push(dependency.pkg);
    }
  }
  return [...reached].filter(id => id !== root.id).map(id => {
    const pkg = packages.get(id);
    if (pkg === undefined) throw new Error(`Cargo resolve references an unknown package: ${id}`);
    return pkg;
  }).sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

function loadCargoMetadata(srcTauriDir) {
  const result = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', TARGET], {
    cwd: srcTauriDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Cannot start cargo metadata: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`cargo metadata exited with code ${result.status}:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function crateLicenseFiles(pkg) {
  const directory = path.dirname(pkg.manifest_path);
  if (!fs.statSync(directory).isDirectory()) throw new Error(`Missing source directory for ${pkg.name}: ${directory}`);
  const names = new Set(fs.readdirSync(directory).filter(name => LICENSE_FILE.test(name)));
  if (pkg.license_file) names.add(pkg.license_file);
  return [...names].sort().map(name => {
    const file = path.resolve(directory, name);
    if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) {
      throw new Error(`License file escapes the crate source directory: ${file}`);
    }
    return { name, text: fs.readFileSync(file, 'utf8') };
  });
}

export function renderDesktopNotices({ nodePin, nodeLicense, crates, groups }) {
  const rust = groups.map((group, index) => {
    const crateList = [...group.crates.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
      .map(crate => `${crate.name} ${crate.version} — SPDX: ${crate.license}`).join('\n');
    return `RUST LICENSE GROUP ${index + 1}\n\nCrates:\n${crateList}\n\nSources:\n${[...group.sources].sort().join('\n')}\n\n${group.text}`;
  }).join('\n\n--------------------------------------------------------------------------------\n\n');
  return `DECKMATE DESKTOP — THIRD-PARTY NOTICES

This file accompanies Deckmate.exe, node.exe and the bundled Deckmate server.
The Deckmate and JavaScript/font notices inside deckmate/ are separate and remain in force.

================================================================================
NODE.JS ${nodePin.version}
================================================================================

Source: https://raw.githubusercontent.com/nodejs/node/v${nodePin.version}/LICENSE
LICENSE SHA-256: ${nodePin.licenseSha256}
This is the complete Node.js LICENSE, including notices for its bundled dependencies.

${nodeLicense.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()}

================================================================================
RUST CRATES IN Deckmate.exe (${crates.length} CRATES, ${groups.length} IDENTICAL-TEXT GROUPS)
================================================================================

Resolved with: cargo metadata --locked --format-version 1 --filter-platform ${TARGET}
Only normal dependencies reachable from the Deckmate release binary are included; build and dev dependencies are excluded.
Identical license texts are grouped. Every crate lists its version and Cargo SPDX expression.

${rust}

================================================================================
MICROSOFT WEBVIEW2 LOADER
================================================================================

${WEBVIEW2.crate} ${WEBVIEW2.crateVersion} statically links WebView2LoaderStatic.lib from
Microsoft.Web.WebView2 SDK ${WEBVIEW2.sdkVersion}.
Source: ${WEBVIEW2.source}

${WEBVIEW2.text}
`;
}

export function generateDesktopNotices({ shellDir, nodePin, nodeLicenseFile }) {
  const srcTauriDir = path.join(shellDir, 'src-tauri');
  const nodeLicenseBytes = fs.readFileSync(nodeLicenseFile);
  const actualNodeLicenseHash = createHash('sha256').update(nodeLicenseBytes).digest('hex');
  if (actualNodeLicenseHash !== nodePin.licenseSha256) {
    throw new Error(`Node.js LICENSE SHA-256 mismatch: expected ${nodePin.licenseSha256}, got ${actualNodeLicenseHash}.`);
  }
  const crates = collectReleaseCrates(loadCargoMetadata(srcTauriDir));
  const webview = crates.find(crate => crate.name === WEBVIEW2.crate);
  if (webview?.version !== WEBVIEW2.crateVersion) {
    throw new Error(`${WEBVIEW2.crate} must be ${WEBVIEW2.crateVersion} to match the recorded Microsoft.Web.WebView2 SDK notice.`);
  }
  const loader = path.join(path.dirname(webview.manifest_path), 'x64', 'WebView2LoaderStatic.lib');
  if (!fs.existsSync(loader)) throw new Error(`Missing statically linked WebView2 loader: ${loader}`);
  const notices = crates.flatMap(crate => noticesForCrate(crate, crateLicenseFiles(crate)));
  const groups = groupIdenticalNotices(notices);
  const text = renderDesktopNotices({
    nodePin,
    nodeLicense: nodeLicenseBytes.toString('utf8'),
    crates,
    groups,
  });
  const output = path.join(srcTauriDir, 'THIRD-PARTY-NOTICES.txt');
  fs.writeFileSync(output, text, 'utf8');
  return { output, bytes: Buffer.byteLength(text), crateCount: crates.length, groupCount: groups.length };
}

function main() {
  const shellDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const nodePin = JSON.parse(fs.readFileSync(path.join(shellDir, 'node-runtime.json'), 'utf8'));
  const nodeLicenseFile = path.join(shellDir, '.cache', `node-v${nodePin.version}-LICENSE`);
  const result = generateDesktopNotices({ shellDir, nodePin, nodeLicenseFile });
  console.log(`desktop-notices: wrote ${result.output} (${result.bytes} bytes, ${result.crateCount} crates, ${result.groupCount} groups)`);
}

const invokedAsScript = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(`desktop-notices: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
