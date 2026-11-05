# The files that make up the site. Everything else stays out of what gets published.
SITE := index.html styles.css src assets

.PHONY: build check test serve clean

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
	exit $$missing

test:
	node --test test/

serve: build
	python3 -m http.server -d public 8000

clean:
	rm -rf public
