# Edge Cases

This fixture exercises skipped heading levels and out-of-order sections.

### Skipped from H1 to H3

Content directly under the H3.

###### Deep H6 without H5

Content under the H6.

## Second Topic

### Child of Second

Content.

#### Grandchild

Content.

## Third Topic

### Child of Third

Content.

## First Topic (out of order)

This section appears after topics numbered higher, to test that the tree follows actual heading order rather than numeric prefixes.

### Another Child

Content.

> Long paragraph follows so wrapping and word-level diff have something to chew on. The quick brown fox jumps over the lazy dog, then repeats the exercise several times to make the line wrap in a normal editor window and to give the comparison engine a realistic amount of text to align.
