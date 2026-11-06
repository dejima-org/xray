# The files that make up the site. Everything else stays out of what gets published.
SITE := index.html styles.css sources.json src assets
# The SIL Open Font License travels with the fonts it covers, so serving them serves it.
FONT_LICENCES := assets/fonts/LICENSE-jost.txt assets/fonts/LICENSE-ibm-plex-serif.txt assets/fonts/LICENSE-jetbrains-mono.txt

.PHONY: build check test serve clean sources unverified

build:
	rm -rf public
	mkdir public
	cp -R $(SITE) public/

# Every local file the page references has to be in the build.
check: build
	@missing=0; \
	for ref in $$(grep -oE '(src|href)="[^"#:]+"' public/index.html | sed -E 's/^(src|href)="//; s/"$$//'); do \
		[ -e "public/$$ref" ] || { echo "missing from the build: $$ref"; missing=1; }; \
	done; \
	for ref in $$(grep -oE 'url\("[^"]+"\)' public/styles.css | sed -E 's/^url\("//; s/"\)$$//'); do \
		[ -e "public/$$ref" ] || { echo "missing from the build: $$ref"; missing=1; }; \
	done; \
	for ref in $(FONT_LICENCES); do \
		[ -e "public/$$ref" ] || { echo "missing from the build: $$ref"; missing=1; }; \
	done; \
	exit $$missing

test:
	node --test test/*.test.mjs

# Which pins in sources.json have fallen behind their projects. Needs read
# access to the forge; XRAY_FORGE overrides where it reads from.
sources:
	node tools/check-sources.mjs

# The rows of the verdict matrix nobody has checked against the code yet:
# everything not in verified/matrix.json. See docs/keeping-current.md.
unverified:
	node tools/matrix.mjs --diff verified/matrix.json > unverified.md
	@echo "wrote unverified.md"

serve: build
	python3 -m http.server -d public 8000

clean:
	rm -rf public
