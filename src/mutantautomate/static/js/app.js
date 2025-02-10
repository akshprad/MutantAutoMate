// @ts-check
// @ts-ignore
import { render } from "preact";
// @ts-ignore
import { useRef, useEffect } from "preact/hooks";
import {
  signal,
  computed,
  batch,
  // @ts-ignore
} from "@preact/signals";
// @ts-ignore
import { html } from "htm/preact";
// @ts-ignore
import $3Dmol from "3dmol";

//const intro_text = `MutantAutoMate is a tool that lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ultricies at tortor ut facilisis. Ut commodo nibh quis nisl porttitor mattis vitae vitae augue. Nam purus mauris, accumsan sit amet vulputate a, placerat vel orci. Sed sagittis eros vel erat ullamcorper, ac faucibus est maximus. Nullam a justo non ipsum porta scelerisque. Duis mauris lacus, volutpat nec lectus ut, congue convallis arcu. Aliquam placerat massa dictum arcu pulvinar viverra et vitae justo. Morbi eu diam lorem. Vivamus sit amet vestibulum nunc, id convallis elit. Fusce augue lacus, suscipit nec mi a, commodo tincidunt metus. Integer sed dui ut nunc luctus tempus.`;
const intro_text = `MutantAutoMate is a powerful tool designed to enhance the analysis of protein structure by enabling interactive visualizations that highlight missense mutations within the full protein structure. Traditional methods of protein visualization, such as static models and diagrams, offer only a snapshot of the protein’s structure. In contrast, MutantAutoMate uses advanced computational techniques to create dynamic, interactive visualizations, allowing researchers to observe conformational changes and movements crucial for protein function.`;
const classes = {
  h2: "text-2xl",
  h3: "text-lg font-bold",
  button:
    "bg-white text-black px-2 py-1 rounded outline outline-1 disabled:bg-gray-200 disabled:text-gray-400",
  bigButton: `text-lg bg-white text-black px-2 py-1 rounded outline outline-1 disabled:bg-gray-200 disabled:text-gray-400 w-full`,
  smallButton: `bg-white text-black rounded outline outline-1 whitespace-nowrap disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-50 [padding-inline:1ch]`,
  input: "block outline outline-2 outline-gray-400 p-1",
  bigInput: `block outline outline-2 outline-gray-400 p-1 w-full text-lg`,
  anchor: "text-blue-700 underline text-left",
};

const gene_name_signal = signal("NLGN1");
const residue1_signal = signal("D");
const position_signal = signal(140);
const residue2_signal = signal("Y");
const events_signal = signal([]);
const is_running_signal = signal(false);

const selected_isoform_signal = signal(null);
const selected_pdb_id_signal = signal(null);

const loading_mutated_signal = signal(false);
const pdb_data_trimmed_signal = signal(null);
const pdb_data_mutated_signal = signal(null);
const sequence_signal = signal(null);
const dssp_signal = signal(null);

const all_isoforms_signal = computed(() => {
  return events_signal.value.find((e) => e.all_isoforms)?.all_isoforms;
});
const sequences_signal = computed(() => {
  return events_signal?.value?.filter((d) => d.type === "sequence") ?? [];
});
const matching_isoforms_signal = computed(() => {
  return events_signal.value.find((e) => e.matching_isoforms)
    ?.matching_isoforms;
});
const filtered_isoforms_signal = computed(() => {
  return events_signal.value.find((e) => e.filtered_isoforms)
    ?.filtered_isoforms;
});

const pdb_ids_signal = computed(() => {
  const pdb_ids = events_signal.value.find((e) => e.pdb_ids)?.pdb_ids;
  return pdb_ids;
});

const log_array_signal = computed(() =>
  events_signal.value
    .map((e) => e.message)
    .filter((d) => typeof d === "string")
    .filter((d) => d !== "")
    .filter((d) => d?.length > 0)
);

const grantham_score_signal = computed(() => {
  return events_signal.value.find((e) => e.type === "grantham_score");
});
const charge_statement_signal = computed(() => {
  return events_signal.value.find((e) => e.type === "charge_statement");
});

function addEvent(event) {
  events_signal.value = [...events_signal.value, event];
}

function startProcessing() {
  // Reset stuff
  batch(() => {
    is_running_signal.value = true;
    events_signal.value = [];
    selected_isoform_signal.value = null;
    selected_pdb_id_signal.value = null;
    pdb_data_trimmed_signal.value = null;
    pdb_data_mutated_signal.value = null;
    sequence_signal.value = null;
    dssp_signal.value = null;
  })


  const url = new URL("/process", window.location.origin);
  url.searchParams.append("gene_name", gene_name_signal);
  url.searchParams.append("residue1", residue1_signal);
  url.searchParams.append("position", position_signal);
  url.searchParams.append("residue2", residue2_signal);

  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    console.info(event.data);
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch (e) {
      console.error(e);
      return;
    }
    addEvent(parsed);
    if (parsed.type === "done") {
      is_running_signal.value = false;
      autoSelectPDB();
      eventSource.close();
    }
  };

  eventSource.onerror = (error) => {
    console.error("EventSource failed:", error);
    eventSource.close();
  };
}

async function fetchSequence(isoform) {
  console.log(`Fetching sequence for ${isoform}`);
  const response = await fetch(
    `https://rest.uniprot.org/uniprotkb/${isoform}.fasta`
  ).then((res) => res.text());
  sequence_signal.value = response.split("\n").slice(1).join("\n");
}

async function getDSSP({ pdb_string }) {
  const dssp_data = await fetch(`/dssp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pdb_string,
    }),
  }).then((res) => res.json());
  dssp_signal.value = dssp_data;
}

async function getMutated({ pdb_string, chain_id, position, to_residue }) {
  loading_mutated_signal.value = true;
  const mutated_pdb_data = await fetch(`/mutate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pdb_string,
      chain_id,
      position,
      to_residue,
    }),
  }).then((res) => res.text());
  pdb_data_mutated_signal.value = mutated_pdb_data;
  loading_mutated_signal.value = false;
}

async function fetchPDB({ isoform, pdb_id, chains }) {
  console.log(`Fetching PDB:`, { isoform, pdb_id, chains });
  selected_isoform_signal.value = isoform;
  selected_pdb_id_signal.value = pdb_id;
  pdb_data_trimmed_signal.value = null;
  pdb_data_mutated_signal.value = null;
  dssp_signal.value = null;
  await fetchSequence(isoform);
  const pdb_string_raw = await fetch(
    `https://files.rcsb.org/download/${pdb_id}.pdb`
  ).then((res) => res.text());
  // NOTE: Just trim to the first chain
  const trim_to_chain = chains?.[0];
  if (!trim_to_chain) {
    throw new Error(`No chains found for ${isoform}`);
    return;
  }
  console.log(`Trimming PDB to chain: ${trim_to_chain}`);
  const trimmed = await fetch(`/trim_pdb`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pdb_data: pdb_string_raw, chains: [trim_to_chain] }),
  }).then((res) => res.text());
  pdb_data_trimmed_signal.value = trimmed;
  await getDSSP({ pdb_string: trimmed });
  await getMutated({
    pdb_string: trimmed,
    chain_id: trim_to_chain,
    position: position_signal.value,
    to_residue: residue2_signal.value
  });
}

async function fetchPDBFromAlphaFold(isoform) {
  console.log(`Fetching from AlphaFold: ${isoform}`);
  selected_isoform_signal.value = isoform;
  selected_pdb_id_signal.value = `AlphaFold`;
  pdb_data_trimmed_signal.value = null;
  pdb_data_mutated_signal.value = null;
  dssp_signal.value = null;
  if (!isoform) return;
  await fetchSequence(isoform);
  const fixed_isoform = isoform.split("-")[0];
  const url = `https://alphafold.ebi.ac.uk/api/prediction/${fixed_isoform}`;
  const response = await fetch(url).then((res) => res.json());
  const [first] = response;
  const pdb_url = first?.pdbUrl;
  const pdb_string_raw = await fetch(pdb_url).then((res) => res.text());
  // We do not need to trim
  pdb_data_trimmed_signal.value = pdb_string_raw;
  await getDSSP({ pdb_string: pdb_string_raw });
  await getMutated({
    pdb_string: pdb_string_raw,
    chain_id: null,
    position: position_signal.value,
    to_residue: residue2_signal.value
  });
}

function autoSelectPDB() {
  const position = position_signal.value;
  const filtered_isoforms = filtered_isoforms_signal.value ?? [];
  const all_pdb_ids = pdb_ids_signal.value ?? {};
  console.log(`Auto-Selecting PDB`, { filtered_isoforms });
  if (filtered_isoforms.length === 0) return;

  const first_isoform = filtered_isoforms[0];

  const first_isoform_pdb_ids = all_pdb_ids[first_isoform] ?? [];

  // Auto-select a PDB. The PDB must be:
  // 1. In the first isoform's list of PDBs
  // 2. The position must be within the range of the PDB
  // 3. We prefer the PDB with the highest resolution

  const valid_pdbs = [];

  for (const [pdb_id, chains_text, resolution_text] of first_isoform_pdb_ids) {
    let chains = null;
    let is_in_pdb = false;
    let position_range = null;
    const resolution = parseFloat(resolution_text);
    if (chains_text) {
      const split = chains_text.split("=");
      const chain_letters = split[0];
      position_range = split[1];
      chains = chain_letters.split("/");
      const [position_start, position_end] = position_range.split("-");
      is_in_pdb = +position >= +position_start && +position <= +position_end;
    }
    if (is_in_pdb) {
      valid_pdbs.push({ pdb_id, chains, resolution });
    }
  }

  let found_pdb = null;

  if (valid_pdbs.length === 0) {
    // Fetch from AlphaFold
    found_pdb = {
      pdb_id: `alphafold`,
      chains: null,
      resolution: NaN,
    };
  } else {
    // Get the highest resolution PDB
    let highest_resolution = Infinity;
    for (const pdb of valid_pdbs) {
      if (pdb.resolution < highest_resolution) {
        highest_resolution = pdb.resolution;
        found_pdb = pdb;
      }
    }
  }

  if (!found_pdb) {
    throw new Error(`found_pdb is undefined for some reason.`);
  }
  const { pdb_id, chains } = found_pdb;
  if (pdb_id === `alphafold`) {
    fetchPDBFromAlphaFold(first_isoform);
  } else {
    fetchPDB({ isoform: first_isoform, pdb_id, chains });
  }
}


function Spacer({ size = 5 }) {
  return html`<div className=${`h-${size}`}></div>`;
}

function Anchor({ children, href }) {
  return html`<a
    href=${href}
    target="_blank"
    rel="noreferrer"
    className=${classes.anchor}
  >
    ${children}
  </a>`;
}

function Inputs() {
  return html`
  <div class="grid grid-cols-2 gap-y-4 gap-x-4">
    <label>
      <div>Gene Name</div>
      <input
        type="text"
        className=${classes.bigInput}
        value=${gene_name_signal}
        onInput=${(e) => (gene_name_signal.value = e.target.value)}
      />
    </label>
    <label>
      <div>Residue 1</div>
      <input
        type="text"
        className=${classes.bigInput}
        value=${residue1_signal}
        onInput=${(e) => (residue1_signal.value = e.target.value)}
      />
    </label>
    <label>
      <div>Position</div>
      <input
        type="text"
        className=${classes.bigInput}
        value=${position_signal}
        onInput=${(e) => (position_signal.value = +e.target.value)}
      />
    </label>
    <label>
      <div>Residue 2</div>
      <input
        type="text"
        className=${classes.bigInput}
        value=${residue2_signal}
        onInput=${(e) => (residue2_signal.value = e.target.value)}
      />
    </label>
    <div class="col-span-2">
      <button
        className=${classes.bigButton}
        disabled=${is_running_signal}
        onClick=${startProcessing}
      >
        Start
      </button>
    </div>
    <div className="col-span-2">
      <div>Status:</div>
      <div>${log_array_signal.value.at(-1) ?? `Pending`}</div>
    </div>
  </div>
  `;
}

function DSSPText() {
  const selected_position = position_signal.value;
  const dssp_data = dssp_signal.value ?? [];
  const dssp_description_string = [];
  const textMap = {
    H: "Helix",
    E: "Strand",
    C: "Coil",
  };
  for (const [frame_index, frame] of dssp_data.entries()) {
    if (frame_index > 0) continue;
    for (const [position, assignment] of frame.entries()) {
      if (position === selected_position) {
        dssp_description_string.push(
          `The secondary structure at position ${position} is "${textMap[assignment]}"`
        );
      }
    }
  }
  let text = html`Pending`;
  if (dssp_description_string.length > 0) {
    text = dssp_description_string.map((d) => html`<div>${d}</div>`)
  }
  return html`
    <div>
      <h2 className=${classes.h2}>DSSP</h2>
      <${Spacer} />
      <div>${text}</div>
    </div>
  `;
}


function TextBoxes() {
  const isoform = selected_isoform_signal.value;
  const pdb_id = selected_pdb_id_signal.value;

  const isoform_anchors = isoform ? html`<div><${IsoformAnchors} isoform=${isoform} /></div>` : null;
  const pdb_url = `https://www.rcsb.org/structure/${pdb_id}`;
  const pdb_anchor = pdb_id ? html`<${Anchor} href=${pdb_url}>${pdb_id}</${Anchor}>` : `Pending`;
  return html`
  <div className="grid grid-cols-4 gap-4 px-10">
    <div>
      <h2 className=${classes.h2}>Selected Isoform</h2>
      <div>${selected_isoform_signal.value ?? `Pending`}</div>
      ${isoform_anchors}
      <${Spacer} />
      <h2 className=${classes.h2}>Selected PDB</h2>
      <div>${pdb_anchor}</div>
    </div>
    <div>
      <h2 className=${classes.h2}>Charge Statement</h2>
      <${Spacer} />
      <div>${charge_statement_signal?.value?.charge_statement ?? `Pending`}</div>
    </div>
    <div>
      <h2 className=${classes.h2}>Grantham Score</h2>
      <${Spacer} />
      <div>${grantham_score_signal?.value?.grantham_statement ?? `Pending`}</div>
    </div>
    <${DSSPText} />
  </div>
`;
}

const usePDBViewer = (pdbSignal, viewer) => {
  useEffect(() => {
    if (!viewer) return;
    if (!pdbSignal.value) {
      viewer.clear();
      return;
    }
    const pdb_data = pdbSignal.value;
    viewer.clear();
    (async () => {
      viewer.addModel(pdb_data, "pdb");
      viewer.setStyle({}, { cartoon: { color: "gray" } });
      viewer.zoomTo();
      viewer.render();
    })();
  }, [pdbSignal.value]);
};

function PDBViewer() {
  const viewerDivRef = useRef(null);
  const viewersGridRef = useRef(null);
  useEffect(() => {
    if (!viewerDivRef.current) {
      return;
    }
    viewersGridRef.current = $3Dmol.createViewerGrid(viewerDivRef.current, {
      rows: 1,
      cols: 2,
      control_all: true,
    });
  }, []);

  usePDBViewer(pdb_data_trimmed_signal, viewersGridRef.current?.[0][0]);
  usePDBViewer(pdb_data_mutated_signal, viewersGridRef.current?.[0][1]);

  const zoom_to = () => {
    const position = +(position_signal?.value ?? 0);
    const grid = viewersGridRef.current;
    if (!grid) return;

    for (const row of grid) {
      for (const viewer of row) {
        // Style for residue in red
        viewer.setStyle(
          { resi: position },
          { stick: { color: "red" }, cartoon: { color: "green", opacity: 0.5 } }
        );
        // Label for residue
        viewer.addLabel(
          position,
          {
            position: "center",
            backgroundOpacity: 0.8,
            fontSize: 12,
            showBackground: true,
          },
          { resi: position }
        );
        // Additional styling and configurations
        // viewer.setStyle(
        //   { hetflag: true },
        //   { stick: { colorscheme: "greenCarbon", radius: 0.25 } }
        // ); // Heteroatoms
        // viewer.setStyle({ bonds: 0 }, { sphere: { radius: 0.5 } }); // Water molecules
        // Zoom and render
        viewer.render();
        // viewer.zoomTo({ resi: position, chain: "A" }, 500);
        viewer.zoomTo({ resi: position }, 500);
      }
    }
  };

  const loading_text = loading_mutated_signal.value
    ? "Loading mutated PDB..."
    : "";

  return html`
    <div class="px-10">
      <h2 className=${classes.h2}>PDB Viewer</h2>
      <${Spacer} />
      <button
        className=${classes.button}
        onClick=${zoom_to}
        disabled=${!pdb_data_trimmed_signal.value}
      >
        Zoom to Position: ${position_signal.value}
      </button>
      <div className="inline-block ml-4 text-lg">${loading_text}</div>
      <${Spacer} />
      <div
        ref=${viewerDivRef}
        className="w-full h-[400px] relative outline outline-black"
      ></div>
    </div>
  `;
}

function SequenceViewer() {
  const value = sequence_signal.value ?? "";
  const letters = value
    .split("")
    .filter((letter) => letter.match(/[A-Z]/))
    .map((letter, index) => {
      let marker = null;
      if ((index + 1) % 50 === 0) {
        marker = html`<span
          className="text-xs text-gray-500 absolute leading-[0] -top-[7px]"
        >
          ${index + 1}
        </span>`;
      }
      const bg = index + 1 === position_signal.value ? "bg-yellow-200 outline outline-2 outline-red-500" : "";
      return html`<span className=${`relative block ${bg}`}>
        ${marker}${letter}
      </span>`;
    });
  const seq = html`<div
    className="flex flex-wrap gap-y-[1.2rem] font-mono leading-none"
  >
    ${letters}
  </div>`;
  return html`
    <div class="px-10">
      <h2 class=${classes.h2}>Sequence</h2>
      <${Spacer} />
      ${value === "" ? `Pending` : seq}
    </div>
  `
}

function IsoformAnchors({ isoform }) {
  const uniprot_url = `https://www.uniprot.org/uniprotkb/${isoform}`;
  const text_url = `https://rest.uniprot.org/uniprotkb/${isoform}.txt`;
  const json_url = `https://rest.uniprot.org/uniprotkb/${isoform}.json`;
  const fasta_url = `https://rest.uniprot.org/uniprotkb/${isoform}.fasta`;
  const uniprot_anchor = html`<${Anchor} href=${uniprot_url}>UniProt</${Anchor}>`;
  const text_anchor = html`<${Anchor} href=${text_url}>Text</${Anchor}>`;
  const json_anchor = html`<${Anchor} href=${json_url}>JSON</${Anchor}>`;
  const fasta_anchor = html`<${Anchor} href=${fasta_url}>FASTA</${Anchor}>`;
  // prettier-ignore
  const anchors = html`${uniprot_anchor} | ${text_anchor} | ${json_anchor} | ${fasta_anchor}`;
  return anchors;
}

function MatchingIsoforms() {
  const position = position_signal.value;
  const filtered_isoforms = filtered_isoforms_signal.value ?? [];
  const cards = filtered_isoforms.map((isoform) => {
    const anchors = html`<${IsoformAnchors} isoform=${isoform} />`
    const pdb_ids = pdb_ids_signal.value?.[isoform] ?? [];
    let pdb_rows = html`<div className="text-gray-500 ml-[3ch]">
      No PDB IDs found
    </div>`;
    if (pdb_ids.length > 0) {
      pdb_rows = pdb_ids.map(([pdb_id, chains_text, resolution_text]) => {
        let chains = null;
        let is_in_pdb = false;
        let position_range = null;
        if (chains_text) {
          const split = chains_text.split("=");
          const chain_letters = split[0];
          position_range = split[1];
          chains = chain_letters.split("/");
          const [position_start, position_end] = position_range.split("-");
          is_in_pdb =
            +position >= +position_start && +position <= +position_end;
        }
        const url = `https://www.rcsb.org/structure/${pdb_id}`;
        const load_button = html`<button
          disabled=${!is_in_pdb}
          className=${classes.smallButton}
          onClick=${() => {
            fetchPDB({ isoform, pdb_id, chains });
          }}
        >
          Load PDB
        </button>`;
        const chains_list = chains ? chains.join(`, `) : `-`;
        const pdb_anchor = html`<${Anchor} href=${url}>${pdb_id}</${Anchor}>`;
        return html`
          <div className="ml-[3ch] flex gap-x-2">
            <span className="font-mono w-[5ch]">${pdb_anchor}</span>
            ${load_button}
            <span>Chains: ${chains_list}</span>
            <span>Range: ${position_range}</span>
            <span>Resolution: ${resolution_text}</span>
          </div>
        `;
      });
    }
    return html`
      <div className="space-y-2">
        <h3 className=${classes.h3}>${isoform}</h3>
        ${anchors}
        <div>PDB IDs:</div>
        <div className="space-y-2">${pdb_rows}</div>
        <button
          className=${classes.smallButton}
          onClick=${() => {
            fetchPDBFromAlphaFold(isoform);
          }}
        >
          Load PDB from Alphafold
        </button>
      </div>
    `;
  });
  return html`
  <div class="px-10">
    <h2 class=${classes.h2}>Matching Isoforms</h2>
    <${Spacer} />
    <div className="space-y-4">${filtered_isoforms.length === 0 ? `Pending` : cards}</div>
  </div>`;
}

function AllIsoforms() {
  const all_isoforms = all_isoforms_signal.value ?? [];
  const sequences = sequences_signal.value ?? [];
  const residue_matches = matching_isoforms_signal.value ?? [];
  const gene_name_matches = filtered_isoforms_signal.value ?? [];
  const rows = all_isoforms.map((isoform) => {
    // const url = `https://rest.uniprot.org/uniprotkb/${isoform}`;
    const url = `https://www.uniprot.org/uniprotkb/${isoform}`;
    const anchor = html`<${Anchor} href=${url}>${isoform}</${Anchor}>`;
    const found_sequence = sequences.find((d) => d.isoform === isoform);
    const found_residue = residue_matches.find((d) => d === isoform);
    const found_gene_name = gene_name_matches.find((d) => d === isoform);
    return html`
      <tr>
        <td>${anchor}</td>
        <td className="text-center">${found_sequence ? `✅` : `-`}</td>
        <td className="text-center">${found_residue ? `✅` : `-`}</td>
        <td className="text-center">${found_gene_name ? `✅` : `-`}</td>
      </tr>
    `;
  });

  const table = html`
    <style>
      table.grid {
        thead,
        tbody,
        tr {
          display: contents;
        }
      }
    </style>
    <table className="grid grid-cols-4">
      <thead>
        <tr className="text-xs">
          <th>Isoform</th>
          <th>Sequence?</th>
          <th>Residue?</th>
          <th>Gene Name?</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  return html`<div class="px-10">
    <h2 class=${classes.h2}>All Isoforms</h2>
    <${Spacer} />
    ${table}
  </div>`
}


function Examples() {
  const others = `SLC6A1 S295, FRMPD4 E471, NRXN1 T324, NRXN1 V1214, ACTB V298`
    .split(`,`)
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .map((string) => {
      const [gene_name, residue] = string.split(" ");
      const residue1 = residue[0];
      const position = +residue.slice(1);
      const residue2 = `C`;
      return [gene_name, residue1, position, residue2];
    });
  const examples = [
    [`NLGN1`, `D`, 140, `Y`],
    [`SHANK3`, `D`, 26, `Y`],
    [`NRXN1`, `K`, 287, `E`],
    [`CSNK1G1`, `T`, 140, `C`],
    [`SCN2A`, `R`, 1635, `C`],
    ...others,
  ];
  const buttons = examples.map(([gene_name, residue1, position, residue2]) => {
    return html`
      <button
        className=${classes.button}
        onClick=${() => {
          gene_name_signal.value = gene_name;
          residue1_signal.value = residue1;
          position_signal.value = position;
          residue2_signal.value = residue2;
          startProcessing();
        }}
      >
        ${gene_name} ${residue1}${position}
      </button>
    `;
  });
  return html`
    <section class="px-10">
      <h2 class=${classes.h2}>Examples</h2>
      <${Spacer} />
      <div className="flex flex-wrap gap-4">${buttons}</div>
    </section>
  `;
}

function App() {
  return html`
  <main class="space-y-4">
    <div
      className="grid lg:grid-cols-2"
    >
      <section class="py-10 px-10" style=${{ backgroundColor: `var(--ccb-green)` }}>
        <h1 class="text-[3rem]">MutantAutoMate</h1>
        <p>${intro_text}</p>
      </section>
      <section class="py-10 px-10">
        <h2 class="text-3xl">Inputs</h2>
        <${Inputs} />
      </section>
    </div>
   <${TextBoxes} />
   <${PDBViewer} />
   <${SequenceViewer} />
   <${Spacer} />
   <${MatchingIsoforms} />
   <${Spacer} />
   <${AllIsoforms} />
   <${Spacer} />
   <${Examples} />
   <${Spacer} />
</main>
  `;
}

render(html`<${App} />`, document.body);
window.scrollTo(0, 0);
