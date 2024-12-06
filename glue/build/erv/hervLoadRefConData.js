// list the betaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-beta'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-beta/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});


// list the kapparetrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-kappa'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-kappa/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});


// list the gammaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-gamma'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-gamma/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

// list the zetaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-zeta'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-zeta/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

// list the rhoretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-rho'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-rho/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

// list the iotaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-iota'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-iota/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

// list the etaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-eta'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-eta/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

// list the thetaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-theta'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-theta/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});


// list the lambdaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-lambda'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-lambda/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

// list the sigmaretrovirus ERV sequences
var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = 'erv-refseqs-sigma'"]);
// extract from the result a list of sequence IDs.
var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

// for each sequence ID
_.each(seqIds, function(seqId) {
    // create an object in the custom table which uses the sequence ID as the row ID.
    glue.command(["create", "custom-table-row", "erv_refcon_data", seqId]);
    // associate the corresponding sequence with this object.
    glue.inMode("sequence/erv-refseqs-sigma/"+seqId, function() {
        glue.command(["set", "link-target", "erv_refcon_data", "custom-table-row/erv_refcon_data/"+seqId]);
    });
});

