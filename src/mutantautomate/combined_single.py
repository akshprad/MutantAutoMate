# Import required libraries
import requests
from requests.adapters import HTTPAdapter, Retry
import re
from io import StringIO
from Bio import SeqIO
from pypdb import *
from bioservices import *
import numpy as np
import os
from Bio import BiopythonDeprecationWarning
import sys
import urllib
import urllib.request
from pathlib import Path
from fpdf import FPDF
from matplotlib.backends.backend_pdf import PdfPages
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import mdtraj as md
from matplotlib import pyplot as plt
import pandas as pd
import os
import mdtraj as md
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib import utils
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Image, ListFlowable, ListItem
import subprocess
import warnings

from Bio.Align import PairwiseAligner

# Suppress warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=BiopythonDeprecationWarning)

# Define regular expression pattern for retrieving next link
re_next_link = re.compile(r'<(.+)>; rel="next"')

# Define retry settings for HTTP requests
retries = Retry(total=5, backoff_factor=0.25, status_forcelist=[500, 502, 503, 504])

# Create a session with retry settings
session = requests.Session()
session.mount("https://", HTTPAdapter(max_retries=retries))


# Function to retrieve the next link from HTTP response headers
def get_next_link(headers):
    if "Link" in headers:
        match = re_next_link.match(headers["Link"])
        if match:
            return match.group(1)


# Function to retrieve all isoforms for a given gene name
def get_all_isoforms(gene_name):
    isoforms = []
    url1 = "https://rest.uniprot.org/uniprotkb/search?query=reviewed:true+AND+"
    url3 = "&includeIsoform=true&format=list&(taxonomy_id:9606)"
    url = url1 + gene_name + url3
    batch_url = url
    while batch_url:
        response = session.get(batch_url)
        response.raise_for_status()
        for isoform in response.text.strip().split("\n"):
            isoform_url = f"https://www.uniprot.org/uniprot/{isoform}.fasta"
            isoform_response = session.get(isoform_url)
            isoform_response.raise_for_status()
            sequence = ''.join(isoform_response.text.strip().split('\n')[1:])
            isoforms.append((isoform, sequence))
        batch_url = get_next_link(response.headers)
    return isoforms


# Function to search for a specific residue at a position in isoforms of a gene
def search_residue(residue, position, gene_name):
    matching_isoforms = []
    all_isoforms = get_all_isoforms(gene_name)
    for isoform, sequence in all_isoforms:
        if len(sequence) > position - 1 and sequence[position - 1] == residue:
            matching_isoforms.append(isoform)
    return matching_isoforms


# User input for gene name and residue information
input_string = input("Enter the gene name and residue information (e.g., SHANK3 D26): ")
gene_name, residue_info = input_string.split()
residue = residue_info[0]
position = int(residue_info[1:])

# Search for matching isoforms
matching_isoforms = search_residue(residue, position, gene_name)
#print(matching_isoforms)

def get_gene_name(uniprot_id):
    url = f"https://www.uniprot.org/uniprot/{uniprot_id}.txt"
    response = requests.get(url)
    lines = response.text.split("\n")
    for line in lines:
        if line.startswith("GN   Name="):
            gene_name = line.split("GN   Name=")[1].split(";")[0]
            return gene_name
    return None

# Function to calculate the gene name for each isoform and filter isoforms with different gene names
def filter_isoforms_by_gene(matching_isoforms, gene_name):
    filtered_isoforms = []
    for isoform in matching_isoforms:
        gene_name_isoform = get_gene_name(isoform)
        if gene_name_isoform == gene_name:
            filtered_isoforms.append(isoform)
    return filtered_isoforms

# Filter isoforms by gene name
matching_isoforms = filter_isoforms_by_gene(matching_isoforms, gene_name)

# Create UniProt object
u = UniProt()

# Retrieve the sequence for the selected isoform
sequence = u.retrieve(matching_isoforms[0:6], "fasta")
fasta_string = sequence
only_element = matching_isoforms[0]
uniprot_id = only_element[0:6]
print(uniprot_id)

# Retrieve the entry for the specified UniProt ID
entry = u.retrieve(uniprot_id, "txt")
sequence = u.retrieve(uniprot_id, "fasta")

fasta_string = sequence

fasta_io = StringIO(fasta_string)
records = SeqIO.parse(fasta_io, "fasta")
for rec in records:
    seq_str = str(rec.seq)

fasta_io.close()

q = Query(seq_str[0:54], query_type="sequence", return_type="polymer_entity")
result = q.search()
#print(result)

if result is None or result is None:
    pdbnewcode = uniprot_id
else:
    highest_score = -1.0
    identifier = ""
    for result in result['result_set']:
        if result['score'] > highest_score:
            highest_score = result['score']
            identifier = result['identifier']
    print("Identifier with the highest score:", identifier[0:4])


# Function to download a PDB file from the Internet
def download_pdb(pdbcode, datadir, downloadurl="https://files.rcsb.org/download/"):
    pdbfn = pdbcode + ".pdb"
    url = downloadurl + pdbfn
    outfnm = os.path.join(datadir, pdbfn)
    try:
        urllib.request.urlretrieve(url, outfnm)
        return outfnm
    except Exception as err:
        print("ERROR")
        return outfnm


# Get the directory of the current file
current_dir = os.path.dirname(os.path.abspath(__file__))


# Function to download a PDB file using the new method for AlphaFold
def new_method_for_alphafold(pdbcode, datadir):
    new_url = "https://alphafold.ebi.ac.uk/files/AF-" + matching_isoforms[0] + "-F1-model_v4.pdb"
    pdbfn2 = pdbcode + ".pdb"
    outfnm2 = os.path.join(datadir, pdbfn2)
    try:
        urllib.request.urlretrieve(new_url, outfnm2)
        return outfnm2
    except Exception as err:
        print("ERROR")
        return outfnm2


# Download or use the new method to get the PDB file
if result is None or result is None:
    pdbpath = new_method_for_alphafold(matching_isoforms[0], current_dir)  # relative path
else:
    pdbpath = download_pdb(identifier[0:4], current_dir)


# Get user input for residue two
residue2 = input("Enter residue two:")


# Function to determine the charge change between two residues
def charge_statement(residue1, residue2):
    aa_charge_dict = {
        "A": "non-polar",
        "C": "polar",
        "D": "negative",
        "E": "negative",
        "F": "bulky",  # "non-polar",
        "G": "non-polar",
        "H": "positive",
        "I": "non-polar",
        "K": "positive",
        "L": "non-polar",
        "M": "non-polar",
        "N": "polar",
        "P": "non-polar",
        "Q": "polar",
        "R": "positive",
        "S": "polar",
        "T": "polar",
        "V": "non-polar",
        "W": "bulky",  # "non-polar",
        "Y": "bulky"  # "polar"
    }

    aa_charge_categories = {
        "positive-to-negative": ["K", "R", "H"],
        "positive-to-hydrophobic": ["K", "R", "H"],
        "negative-to-positive": ["D", "E"],
        "negative-to-hydrophobic": ["D", "E"],
        "hydrophobic-to-positive": ["A", "F", "G", "I", "L", "M", "P", "V", "W", "Y"],
        "hydrophobic-to-negative": ["A", "F", "G", "I", "L", "M", "P", "V", "W", "Y"],
        "hydrophobic-to-polar": ["A", "F", "G", "I", "L", "M", "P", "V", "W", "Y"],
        "polar-to-hydrophobic": ["C", "N", "Q", "S", "T", "Y"],
        "polar-to-positive": ["C", "N", "Q", "S", "T", "Y"],
        "polar-to-negative": ["C", "N", "Q", "S", "T", "Y"],
        "non-polar-to-polar": ["A", "F", "G", "I", "L", "M", "P", "V", "W", "Y"]
    }

    residue1_charge = aa_charge_dict[residue1]
    residue2_charge = aa_charge_dict[residue2]

    score = (
        f"{amino_acids.get(residue1)} at position {position} to {amino_acids.get(residue2)}"
        + " is a mutation from a " + f"{residue1_charge}" + " charged amino acid to a " + f"{residue2_charge}" + " amino acid"
    )
    return score


# Get the charge change score
score = charge_statement(residue, residue2)


# Define the path for the snapshot script
bash_script = os.path.join(current_dir, "snapshot.sh")


# Extract the filename from the bash_script path
filename = os.path.basename(bash_script)


# Append "snapshot.sh" to the filename
snapshot_script = os.path.join(current_dir, filename, "snapshot.sh")


# Set file1 to the pdbpath
file1 = pdbpath


# Convert the position to string
converted_position = str(position)


# Run the bash script using subprocess with arguments
output = subprocess.run(["bash", bash_script, file1, converted_position], capture_output=True, text=True)


# Extract the output path from the command's standard output
screenshot = os.path.join(current_dir, "snap.png")


# Load the protein trajectory and topology using mdtraj
traj = md.load(pdbpath)
topology = traj.topology


# Compute the RMSD of each frame in the trajectory to a reference structure
reference_frame = traj[0]  # Assuming the first frame is your reference
rmsd = md.rmsd(traj, reference_frame)


# Compute the SASA for each residue in each frame
sasa = md.shrake_rupley(traj)


# Choose thresholds for RMSD and SASA to determine the structured region
rmsd_threshold = 0.3  # Adjust as per your requirements
sasa_threshold = 10.0  # Adjust as per your requirements


# Ensure that rmsd and sasa have the same number of frames
num_frames = min(rmsd.shape[0], sasa.shape[0])
rmsd = rmsd[:num_frames]
sasa = sasa[:num_frames]


# Find the frames where the RMSD and SASA values are below the thresholds
structured_frames = (rmsd < rmsd_threshold) & (sasa[:, :, np.newaxis] > sasa_threshold)


# Find the residues that are present in the structured frames
structured_residues = []
for residue in topology.residues:
    residue_frames = structured_frames[:, residue.index]
    if residue_frames.any():
        structured_residues.append(residue)


target_residue_code = 'L'  # Modify this to the desired amino acid code
target_position = 27  # Modify this to the desired residue position


target_residue_name = topology.residue(target_position).name

if target_residue_name is None:
    print(f'Invalid amino acid code: {target_residue_code}')
else:
    # Check if the target residue is present in the structured frames
    target_residue_index = topology.residue(target_position).index
    residue_frames = structured_frames[:, target_residue_index]
    if residue_frames.any():
        structured_or_not = f"Residue {residue_info} is in a structured part of the protein."
    else:
        structured_or_not = f"Residue {residue_info} is not in a structured part of the protein."


# Generate the final output message
output_message = (
    "For gene " + gene_name + ", " + str(residue_info) + str(residue2) + " is a mutation from " + str(score) + ".\n" +
    structured_or_not
)
print(output_message)


# Define the dictionary of amino acid names
amino_acids = {
    'A': 'Alanine',
    'C': 'Cysteine',
    'D': 'Aspartic Acid',
    'E': 'Glutamic Acid',
    'F': 'Phenylalanine',
    'G': 'Glycine',
    'H': 'Histidine',
    'I': 'Isoleucine',
    'K': 'Lysine',
    'L': 'Leucine',
    'M': 'Methionine',
    'N': 'Asparagine',
    'P': 'Proline',
    'Q': 'Glutamine',
    'R': 'Arginine',
    'S': 'Serine',
    'T': 'Threonine',
    'V': 'Valine',
    'W': 'Tryptophan',
    'Y': 'Tyrosine'
}


# Generate a PDF summary for the mutant
def generate_pdf(image_path, screenshot_path):
    # Create a new PDF document with letter size
    name = gene_name + "_" + residue_info + str(residue2)
    doc = SimpleDocTemplate(f"{name}.pdf", pagesize=letter, rightMargin=50)

    # Define the print statements to be written to the PDF
    print_statements = [
        f"These are the MutantAutoMate results for the {gene_name} {residue_info} mutant.",
        f"For the gene {gene_name}, the residue {amino_acids.get(res)} at position {position} goes from {amino_acids.get(res)} to {amino_acids.get(residue2)}.",
        f"The UniProt ID for the matched isoform is {matching_isoforms[0]}",
        f"Matching UniProt IDs were: {matching_isoforms}",
        "Parameters that may contribute to the pathogenicity of the mutant are: charge change, presence on alpha-helix strand, and change in solvent accessible surface area.",
        f"{score}."
    ]

    # Modify the print_statements list to include the additional lines
    print_statements.extend([
        "It's important to note that the specific effect of a point mutation on the pathogenicity of a mutation will depend on many factors, including the nature of the amino acid change, the location of the mutation within the alpha helix, the role of the affected residue in protein function, and the overall protein context.",
        "Detailed experimental or computational analysis is typically required to accurately assess the impact of a point mutation on pathogenicity in a specific protein."
    ])

    # Create a list to hold the flowables (Paragraphs, Images, and Bullet List)
    flowables = []

    # Load and add the logo image to the flowables
    logo = utils.ImageReader(image_path)
    logo_width, logo_height = logo.getSize()
    logo_scale = 0.1  # Adjust the scale as needed
    logo_width *= logo_scale
    logo_height *= logo_scale
    img = Image(image_path, width=logo_width, height=logo_height)
    img.hAlign = 'RIGHT'  # Align the image to the right side
    img.top = doc.pagesize[1] - logo_height  # Position the image at the top-right corner
    flowables.append(img)

    # Add the title at the top of the PDF
    styles = getSampleStyleSheet()
    title_text = "MutantAutoMate"
    title = Paragraph(title_text, styles["Title"])
    flowables.append(title)

    # Create a Bullet List flowable
    bullet_list = ListFlowable(
        [
            ListItem(Paragraph(statement, styles["Bullet"])) for statement in print_statements
        ],
        bulletType="bullet",
        leftIndent=40,
        rightIndent=10,
        start='bulletchar',
        bulletColor='black',
        bulletFontName='Helvetica',
        bulletFontSize=10,
        bulletOffsetY=-2,
        bulletDedent='auto',
        spaceAfter=12
    )
    flowables.append(bullet_list)

    # Load and add the screenshot image to the flowables
    screenshot = utils.ImageReader(screenshot_path)
    screenshot_width, screenshot_height = screenshot.getSize()
    screenshot_scale = 0.5  # Adjust the scale as needed
    screenshot_width *= screenshot_scale
    screenshot_height *= screenshot_scale
    screenshot_img = Image(screenshot_path, width=screenshot_width, height=screenshot_height)
    screenshot_img.hAlign = 'CENTER'  # Align the image to the center
    flowables.append(screenshot_img)

    # Build the PDF document with the flowables
    doc.build(flowables)
    print("Your PDF summary for this mutant has been created!")


# Get the directory of the current file
current_dir = os.path.dirname(os.path.abspath(__file__))


# Set the image filename
image_filename = "logo.png"


# Join the directory path with the image filename
image_path = os.path.join(current_dir, image_filename)


# Call the function to generate the PDF
generate_pdf(image_path, screenshot)
