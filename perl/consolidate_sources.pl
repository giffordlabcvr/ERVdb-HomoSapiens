#!/usr/bin/env perl
use strict;
use warnings;
use File::Basename;
use File::Path qw(make_path);
use File::Copy qw(copy);

# Usage: perl consolidate_sources.pl <input_sources_dir> <output_sources_dir>

my ($in_root, $out_root) = @ARGV;
die "Usage: $0 <input_sources_dir> <output_sources_dir>\n"
  unless defined $in_root && defined $out_root;

-d $in_root or die "Input directory '$in_root' does not exist\n";
make_path($out_root) unless -d $out_root;

# Map base name -> { fwd => dir, rev => dir }
opendir(my $dh, $in_root) or die "Cannot open $in_root: $!";
my %bases;
while (my $entry = readdir($dh)) {
    next if $entry =~ /^\./;              # skip . and ..
    my $path = "$in_root/$entry";
    next unless -d $path;                 # only care about directories

    if ($entry =~ /^(.*)_fwd$/) {
        $bases{$1}{fwd} = $path;
    }
    elsif ($entry =~ /^(.*)_rev$/) {
        $bases{$1}{rev} = $path;
    }
    # anything else is ignored (e.g. other helper dirs)
}
closedir $dh;

for my $base (sort keys %bases) {
    my $dest = "$out_root/$base";
    make_path($dest) unless -d $dest;

    print STDERR "Processing base '$base' -> $dest\n";

    # 1) copy forward-strand files as-is
    if (my $fwd_dir = $bases{$base}{fwd}) {
        opendir(my $fdh, $fwd_dir) or die "Cannot open $fwd_dir: $!";
        while (my $f = readdir($fdh)) {
            next if $f =~ /^\./;
            my $src = "$fwd_dir/$f";
            next unless -f $src;
            my $dst = "$dest/$f";
            copy($src, $dst) or die "Copy failed $src -> $dst: $!";
        }
        closedir $fdh;
    }

    # 2) reverse-complement reverse-strand files
    if (my $rev_dir = $bases{$base}{rev}) {
        opendir(my $rdh, $rev_dir) or die "Cannot open $rev_dir: $!";
        while (my $f = readdir($rdh)) {
            next if $f =~ /^\./;
            my $src = "$rev_dir/$f";
            next unless -f $src;
            my $dst = "$dest/$f";

            open my $IN,  "<", $src or die "Cannot open $src: $!";
            open my $OUT, ">", $dst or die "Cannot write $dst: $!";
            rc_fasta($IN, $OUT);
            close $IN;
            close $OUT;
        }
        closedir $rdh;
    }
}

exit 0;

# Reverse-complement all sequences in a FASTA stream
sub rc_fasta {
    my ($IN, $OUT) = @_;

    my @seq;

    while (my $line = <$IN>) {
        if ($line =~ /^>/) {
            # flush previous sequence (if any)
            if (@seq) {
                my $seq = reverse join("", @seq);
                # Complement IUPAC DNA codes (upper & lower)
                $seq =~ tr/ACGTRYKMSWBDHVNacgtrykmswbdhvn/TGCAYRMKSWVHDBNtgcayrmkswvhdbn/;
                # wrap at 60 chars
                $seq =~ s/(.{1,60})/$1\n/g;
                print $OUT $seq;
                @seq = ();
            }
            print $OUT $line;  # header unchanged
        }
        else {
            $line =~ s/\s+//g;
            next unless length $line;
            push @seq, $line;
        }
    }

    # last sequence
    if (@seq) {
        my $seq = reverse join("", @seq);
        $seq =~ tr/ACGTRYKMSWBDHVNacgtrykmswbdhvn/TGCAYRMKSWVHDBNtgcayrmkswvhdbn/;
        $seq =~ s/(.{1,60})/$1\n/g;
        print $OUT $seq;
    }
}
