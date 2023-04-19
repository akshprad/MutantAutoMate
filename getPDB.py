import requests
from requests.adapters import HTTPAdapter, Retry
import re
from pypdb import *
from bioservices import *
from pypdb import *
import os
import sys
import urllib
import urllib.request

#user input gene name
gene_name = input("Enter the residue you want to search for (e.g., SHANK3): ")

re_next_link = re.compile(r'<(.+)>; rel="next"')
retries = Retry(total=5, backoff_factor=0.25, status_forcelist=[500, 502, 503, 504])
session = requests.Session()
session.mount("https://", HTTPAdapter(max_retries=retries))

def get_next_link(headers):
    if "Link" in headers:
        match = re_next_link.match(headers["Link"])
        if match:
            return match.group(1)



def get_all_isoforms():
    isoforms = []
    url1 = "https://rest.uniprot.org/uniprotkb/search?query=reviewed:true+AND+"
    url3 = "&includeIsoform=true&format=list&(taxonomy_id:9606)"
    url = url1 + gene_name + url3
    #https://www.uniprot.org/uniprotkb?query=(gene:shank3)%20AND%20(taxonomy_id:9606)
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

def search_residue(residue, position):
    matching_isoforms = []
    all_isoforms = get_all_isoforms()
    for isoform, sequence in all_isoforms:
        if len(sequence) > position-1 and sequence[position-1] == residue:
            matching_isoforms.append(isoform)
    return matching_isoforms



residue = input("Enter the residue you want to search for (e.g., D): ")
position = int(input("Enter the position of the residue you want to search for (e.g., 26): "))
matching_isoforms = search_residue(residue, position)
if len(matching_isoforms) > 0:
    print(f"The residue {residue} is present at position {position} in the following isoform(s):")
    for isoform in matching_isoforms:
        print(isoform)
else:
    print(f"The residue {residue} is not present at position {position} in any of the isoforms.")

#print(matching_isoforms[0])

#first uniprot match to fasta sequence
u = UniProt()
sequence = u.retrieve(matching_isoforms[0],"fasta")
# print(sequence)

from io import StringIO
from Bio import SeqIO

fasta_string = sequence
#print(fasta_string)

fasta_io = StringIO(fasta_string) 

records = SeqIO.parse(fasta_io, "fasta") 

for rec in records:
    #print(rec)
    seq_str = str(rec.seq)
    print(seq_str[0:54])

fasta_io.close() 

#fasta to PDBID
u = UniProt()
sequence = u.retrieve("Q9BYB0","fasta")

q = Query(seq_str[0:54], 
          query_type="sequence", 
          return_type="polymer_entity")

result = q.search()  # perform the search and get the result
highest_score = -1.0
identifier = ""

for result in result['result_set']:
    if result['score'] > highest_score:
        highest_score = result['score']
        identifier = result['identifier']

print("Identifier with the highest score:", identifier[0:4])

#download PDB from RCSB

def download_pdb(pdbcode, datadir, downloadurl="https://files.rcsb.org/download/"):
    """
    Downloads a PDB file from the Internet and saves it in a data directory.
    :param pdbcode: The standard PDB ID e.g. '3ICB' or '3icb'
    :param datadir: The directory where the downloaded file will be saved
    :param downloadurl: The base PDB download URL, cf.
        `https://www.rcsb.org/pages/download/http#structures` for details
    :return: the full path to the downloaded PDB file or None if something went wrong
    """
    pdbfn = pdbcode + ".pdb"
    url = downloadurl + pdbfn
    outfnm = os.path.join(datadir, pdbfn)
    try:
        urllib.request.urlretrieve(url, outfnm)
        print(url)
        print(outfnm)
        return outfnm
    except Exception as err:
        print(str(err), file=sys.stderr)
        return None

download_pdb(identifier[0:4], "/Users/asameerpradhan/Desktop")

#mutate PDB sequence
def mutate_pdb_residue(input_pdb_path, output_pdb_path, target_resnum, target_chain, target_new_resname):
    """
    Mutates a residue in a PDB file by changing its residue name.

    Args:
        input_pdb_path (str): Path to the input PDB file.
        output_pdb_path (str): Path to the output PDB file.
        target_resnum (int): Residue number of the target residue to be mutated.
        target_chain (str): Chain ID of the target residue to be mutated.
        target_new_resname (str): New residue name for the target residue.

    Returns:
        None
    """
    with open(input_pdb_path, 'r') as f_in:
        with open(output_pdb_path, 'w') as f_out:
            for line in f_in:
                if line.startswith('ATOM') or line.startswith('HETATM'):
                    chain = line[21]
                    resnum = int(line[22:26])
                    resname = line[17:20]
                    if chain == target_chain and resnum == target_resnum:
                        resname = target_new_resname
                    line = line[:17] + resname + line[20:]
                f_out.write(line)


# Example usage
input_pdb_path = '6kyk.pdb'
output_pdb_path = '6kyk_mutated.pdb'

# Get user input for target residue number and mutant name
target_resnum = int(input("Enter target residue number: "))
target_chain = input("Enter target chain ID: ")
target_new_resname = input("Enter new residue name for mutation: ")

mutate_pdb_residue(input_pdb_path, output_pdb_path, target_resnum, target_chain, target_new_resname)

print(f"Successfully mutated residue {target_resnum} in chain {target_chain} to {target_new_resname}.")
print(f"Mutated PDB file saved as {output_pdb_path}.")
