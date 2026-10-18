/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/sparseMatrix.h` (`SparseMatrix<float>`), Copyright 2018 DreamWorks
 * Animation LLC: rows of (column, weight) pairs, packed in one array, sized row by row.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Elements are float values held in a `number[]` (every write is rounded by its caller).
 */

export class SparseMatrix {
    numRows = 0
    numColumns = 0
    numElements = 0
    rowOffsets: number[] = []
    columns: number[] = []
    elements: number[] = []

    getNumRows() { return this.numRows }
    getNumColumns() { return this.numColumns }
    getNumElements() { return this.numElements }
    getCapacity() { return this.elements.length }

    getRowSize(row: number) { return this.rowOffsets[row + 1] - this.rowOffsets[row] }
    rowOffset(row: number) { return this.rowOffsets[row] }

    /** `Resize` (:135): existing elements are kept (rows are re-sized and overwritten by the caller). */
    resize(numRows: number, numCols: number, numElementsToReserve: number): void {
        this.numRows = numRows
        this.numColumns = numCols
        this.numElements = 0
        this.rowOffsets = new Array<number>(numRows + 1).fill(-1)
        this.rowOffsets[0] = 0
        if (numElementsToReserve > this.getCapacity()) {
            while (this.columns.length < numElementsToReserve) this.columns.push(0)
            while (this.elements.length < numElementsToReserve) this.elements.push(0)
        }
    }

    /** `SetRowSize` (:153). */
    setRowSize(row: number, rowSize: number): void {
        if (this.rowOffsets[row] !== this.numElements) throw new Error('SparseMatrix::SetRowSize: rows must be sized in order')
        const newVectorSize = this.rowOffsets[row] + rowSize
        this.rowOffsets[row + 1] = newVectorSize
        this.numElements = newVectorSize
        if (newVectorSize > this.getCapacity()) {
            while (this.columns.length < newVectorSize) this.columns.push(0)
            while (this.elements.length < newVectorSize) this.elements.push(0)
        }
    }

    /** `Swap` (:183). */
    swap(other: SparseMatrix): void {
        [this.numRows, other.numRows] = [other.numRows, this.numRows];
        [this.numColumns, other.numColumns] = [other.numColumns, this.numColumns];
        [this.numElements, other.numElements] = [other.numElements, this.numElements];
        [this.rowOffsets, other.rowOffsets] = [other.rowOffsets, this.rowOffsets];
        [this.columns, other.columns] = [other.columns, this.columns];
        [this.elements, other.elements] = [other.elements, this.elements]
    }
}
