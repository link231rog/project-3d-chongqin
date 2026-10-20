// Rows run south to north; samples use WGS84 longitude/latitude and EGM96 metres.
export function sampleElevation(grid, longitude, latitude) {
  const column = Math.max(0, Math.min(grid.columns - 1, (longitude - grid.west) / grid.stepLongitude));
  const row = Math.max(0, Math.min(grid.rows - 1, (latitude - grid.south) / grid.stepLatitude));
  const left = Math.min(Math.floor(column), grid.columns - 2);
  const bottom = Math.min(Math.floor(row), grid.rows - 2);
  const x = column - left, y = row - bottom;
  const southWest = grid.elevations[bottom * grid.columns + left];
  const southEast = grid.elevations[bottom * grid.columns + left + 1];
  const northWest = grid.elevations[(bottom + 1) * grid.columns + left];
  const northEast = grid.elevations[(bottom + 1) * grid.columns + left + 1];
  return (southWest * (1 - x) + southEast * x) * (1 - y)
    + (northWest * (1 - x) + northEast * x) * y;
}
