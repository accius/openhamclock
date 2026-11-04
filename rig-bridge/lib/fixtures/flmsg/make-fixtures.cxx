// Fixture generator for rig-bridge/lib/flmsg-format tests. Not part of the build.
//
// Reproduces flmsg's own code paths with flmsg's own sources, so the fixtures
// are what flmsg writes, byte for byte (git.code.sf.net/p/fldigi/flmsg):
//
//   git clone https://git.code.sf.net/p/fldigi/flmsg flmsg-src
//   mkdir stub && printf '#pragma once\n#define LOG_ERROR(...)\n#define LOG_INFO(...)\n' > stub/debug.h
//   cp flmsg-src/src/include/crc16.h flmsg-src/src/include/base64.h stub/
//   L=flmsg-src/src/lzma
//   cc -c -O1 $L/LzmaLib.c $L/LzmaEnc.c $L/LzmaDec.c $L/LzFind.c $L/Alloc.c
//   c++ -std=c++11 -Istub -I$L make-fixtures.cxx flmsg-src/src/utils/base64.cxx *.o -o gen && ./gen
//   # unsigned-char build (Linux ARM behaviour of Ccrc16): add -funsigned-char
//
// ics213-nonascii-signed.wrap came from the default (signed char) build,
// ics213-nonascii-unsigned.wrap from the -funsigned-char build.
//
//  - lineout()/header()             src/flmsg.cxx
//  - compress_maybe()               src/utils/wrap.cxx  (LzmaCompress level 4, "\1LZMA" + BE len + props + data, base64 armour)
//  - wrapfile()                     src/utils/wrap.cxx  (CRC over "[WRAP:fn name]" + text)
//  - Ccrc16                         src/include/crc16.h
#include <string>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <arpa/inet.h>
#include "crc16.h"
#include "base64.h"
extern "C" {
#include "LzmaLib.h"
}
using std::string;
static string lineout(const string &field, const string &data) {
  if (data.empty()) return "";
  char n[80]; snprintf(n, sizeof n, "%0d", (int)data.length());
  return field + n + " " + data + "\n";
}
static string header(const char *type, const string &from) {
  string h = "<flmsg>4.0.23\n";
  h += lineout(":hdr_fm:", from);
  h += lineout(":hdr_ed:", from);
  h += string(type) + "\n";
  return h;
}
static void compress(string &input) {
  size_t outlen = (size_t)ceil(input.length() * 1.1) + 64;
  unsigned char *buf = new unsigned char[outlen];
  size_t plen = LZMA_PROPS_SIZE; unsigned char props[LZMA_PROPS_SIZE];
  uint32_t origlen = htonl(input.length());
  string s = "\1LZMA";
  int r = LzmaCompress(buf, &outlen, (const unsigned char *)input.data(), input.length(), props, &plen, 4, 0, -1, -1, -1, -1, -1);
  if (r != SZ_OK) { fprintf(stderr, "lzma %d\n", r); exit(1); }
  s.append((const char *)&origlen, 4); s.append((const char *)props, 5); s.append((const char *)buf, outlen);
  base64 b64(1);
  input = string("[b64:start]") + b64.encode(s) + "[b64:end]";
  delete[] buf;
}
static string wrap(const string &fname, const string &text) {
  Ccrc16 c;
  string in = "[WRAP:fn " + fname + "]" + text;
  string ck = c.scrc16(in);
  return "[WRAP:beg][WRAP:lf]" + in + "[WRAP:chksum " + ck + "][WRAP:end]";
}
static void write(const char *path, const string &s) { FILE *f = fopen(path, "wb"); fwrite(s.data(), 1, s.size(), f); fclose(f); }
int main() {
  string from = "\nN8TAG 20261510143200";  // update_header(FROM): "\n" + call + " " + YYYYDDMMhhmmss
  string fields;
  fields += lineout(":inc:", "Spring Flood 2026");
  fields += lineout(":to:", "Logistics Section Chief");
  fields += lineout(":p1:", "EOC");
  fields += lineout(":fm:", "Shelter 3 Manager");
  fields += lineout(":p2:", "Lincoln HS Shelter");
  fields += lineout(":d1:", "2026-10-15");
  fields += lineout(":t1:", "1432L");
  fields += lineout(":sb:", "Cots required");
  fields += lineout(":s1:", "J. Smith");
  fields += lineout(":p3:", "Shelter Manager");
  fields += lineout(":mg:", "Need 40 cots and 80 blankets at Lincoln HS shelter by 1800 local.\nCurrent census 112, capacity 150.\nGRID EM29qb");
  string plain = header("<ics213>", from) + fields;
  write("ics213-plain.213", plain);
  write("ics213-plain.wrap", wrap("N8TAG-20261015-143200.213", plain));
  string cf = fields; compress(cf);
  write("ics213-lzma.wrap", wrap("N8TAG-20261015-143200.213", header("<ics213>", from) + cf));
  // radiogram (src/radiogram/radiogram.cxx field order)
  string rg = header("<radiogram>", "\nN8TAG 20261510120000");
  rg += lineout(":nbr:", "42"); rg += lineout(":prec:", "PRIORITY"); rg += lineout(":hx:", "HXG");
  rg += lineout(":d1:", "OCT 15"); rg += lineout(":t1:", "1200Z");
  rg += lineout(":to:", "American Red Cross\nColumbus Chapter"); rg += lineout(":tel:", "614-555-0100");
  rg += lineout(":msg:", "SHELTER AT LINCOLN HS OPEN X CAPACITY 150 X NEED COTS"); rg += lineout(":sig:", "J SMITH");
  rg += lineout(":ck:", "12"); rg += lineout(":sta:", "N8TAG"); rg += lineout(":org:", "Columbus OH");
  write("welfare.m2s", rg);
  // non-ASCII form, wrapped: checksum differs between signed-char and unsigned-char builds
  string na = header("<ics213>", from) + lineout(":to:", "EOC") + lineout(":sb:", "Caf\xc3\xa9 St\xc3\xa4" "dtler") + lineout(":mg:", "Wasser f\xc3\xbcr 20 Personen");
  write("ics213-nonascii.wrap", wrap("na.213", na));
  Ccrc16 c;
  const char *samples[] = { "123456789", "caf\xc3\xa9", "[WRAP:fn x.213]Stra\xc3\x9f" "e 12\n", "\xe2\x82\xac" "50 \xc3\xa9t\xc3\xa9", 0 };
  for (int i = 0; samples[i]; i++) printf("CRC %s\n", c.scrc16(samples[i]).c_str());
  return 0;
}
